/**
 * In-memory file cache with semantic embedding support
 * Stores file content and vector embeddings received from the CLI watcher
 */

import { pipeline, Pipeline } from '@xenova/transformers';
import { LocalIndex } from 'vectra';
import * as path from 'path';

interface CachedFile {
  content: string;
  lastModified: number;
  embedding?: number[] | null; // Vector embedding for semantic search
}

export class FileCache {
  private cache: Map<string, CachedFile>;
  private embedder: Pipeline | null = null;
  private isInitializing: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private vectorIndex: LocalIndex;
  private indexInitialized: boolean = false;

  constructor() {
    this.cache = new Map();
    // Initialize vectra index (will be created/loaded on first use)
    const indexPath = path.join(process.cwd(), 'vector_index');
    this.vectorIndex = new LocalIndex(indexPath);
    this._initializeVectorIndex();
  }

  /**
   * Initialize the vector index
   */
  private async _initializeVectorIndex(): Promise<void> {
    if (this.indexInitialized) {
      return;
    }

    try {
      console.log('🔧 [VECTOR_INDEX] Initializing vector index...');
      
      // Check if index exists, create if not
      if (!await this.vectorIndex.isIndexCreated()) {
        console.log('📁 [VECTOR_INDEX] Creating new vector index...');
        await this.vectorIndex.createIndex();
      }
      
      this.indexInitialized = true;
      console.log('✅ [VECTOR_INDEX] Vector index initialized successfully');
    } catch (error) {
      console.error('❌ [VECTOR_INDEX] Failed to initialize vector index:', error);
      // Don't throw - allow system to continue without search capability
    }
  }

  /**
   * Initialize the embedding model (lazy loading)
   * Uses Xenova/all-MiniLM-L6-v2 for generating 384-dimensional embeddings
   */
  private async _initializeEmbedder(): Promise<void> {
    // If already initialized, return immediately
    if (this.embedder) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.isInitializing && this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.isInitializing = true;
    this.initializationPromise = (async () => {
      try {
        console.log('🔧 [EMBEDDER] Initializing embedding model (Xenova/all-MiniLM-L6-v2)...');
        this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('✅ [EMBEDDER] Embedding model initialized successfully');
      } catch (error) {
        console.error('❌ [EMBEDDER] Failed to initialize embedding model:', error);
        throw error;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Generate embedding for file content
   * @param content File content to embed
   * @returns 384-dimensional embedding vector
   */
  private async _generateEmbedding(content: string): Promise<number[] | null> {
    try {
      // Ensure embedder is initialized
      await this._initializeEmbedder();

      if (!this.embedder) {
        console.error('❌ [EMBEDDER] Embedder not available after initialization');
        return null;
      }

      // Truncate very large files to avoid memory issues
      const maxChars = 5000;
      const truncatedContent = content.length > maxChars 
        ? content.substring(0, maxChars) + '...' 
        : content;

      // Generate embedding with mean pooling and normalization
      const output = await this.embedder(truncatedContent, {
        pooling: 'mean',
        normalize: true,
      });

      // Convert to regular array
      const embedding = Array.from(output.data) as number[];
      
      return embedding;
    } catch (error) {
      console.error('❌ [EMBEDDER] Error generating embedding:', error);
      return null;
    }
  }

  /**
   * Generate and store embedding for a cached file
   * @param filePath Path of the file
   * @param content File content
   */
  private async _generateAndStoreEmbedding(filePath: string, content: string): Promise<void> {
    try {
      console.log(`🔍 [EMBEDDER] Generating embedding for: ${filePath}`);
      const embedding = await this._generateEmbedding(content);

      if (embedding) {
        // Update the cache entry with the embedding
        const existing = this.cache.get(filePath);
        if (existing) {
          existing.embedding = embedding;
          console.log(`✅ [EMBEDDER] Embedding stored for ${filePath} (${embedding.length} dimensions)`);
        }

        // Add/update in vectra index
        try {
          await this._initializeVectorIndex(); // Ensure index is ready
          
          await this.vectorIndex.upsertItem({
            id: filePath,
            vector: embedding,
            metadata: { filePath }
          });
          
          console.log(`✅ [VECTOR_INDEX] Added ${filePath} to search index`);
        } catch (indexError) {
          console.error(`❌ [VECTOR_INDEX] Failed to add ${filePath} to index:`, indexError);
        }
      } else {
        console.warn(`⚠️ [EMBEDDER] Failed to generate embedding for ${filePath}`);
      }
    } catch (error) {
      console.error(`❌ [EMBEDDER] Error storing embedding for ${filePath}:`, error);
    }
  }

  async set(filePath: string, data: CachedFile): Promise<void> {
    // Store the file data first
    this.cache.set(filePath, data);
    
    // Generate and store embedding asynchronously (non-blocking)
    // Don't await to avoid blocking file cache operations
    this._generateAndStoreEmbedding(filePath, data.content).catch(error => {
      console.error(`❌ [EMBEDDER] Background embedding generation failed for ${filePath}:`, error);
    });
  }

  get(filePath: string): CachedFile | undefined {
    return this.cache.get(filePath);
  }

  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  delete(filePath: string): boolean {
    return this.cache.delete(filePath);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  entries(): IterableIterator<[string, CachedFile]> {
    return this.cache.entries();
  }

  /**
   * Get all files matching a pattern or extension
   */
  getFilesMatching(pattern: RegExp): Array<{ path: string; content: string }> {
    const matches: Array<{ path: string; content: string }> = [];
    
    for (const [path, data] of this.cache.entries()) {
      if (pattern.test(path)) {
        matches.push({ path, content: data.content });
      }
    }
    
    return matches;
  }

  /**
   * Search for relevant code context using semantic similarity
   * @param query User's question or search query
   * @param topK Number of most relevant files to return (default: 5)
   * @returns Formatted context string with relevant file contents
   */
  async searchSemanticContext(query: string, topK: number = 5): Promise<string> {
    try {
      console.log(`🔍 [SEMANTIC_SEARCH] Searching for: "${query}" (top ${topK})`);

      // Ensure embedder is initialized
      await this._initializeEmbedder();
      await this._initializeVectorIndex();

      // Generate query embedding
      const queryEmbedding = await this._generateEmbedding(query);
      
      if (!queryEmbedding) {
        console.warn('⚠️ [SEMANTIC_SEARCH] Failed to generate query embedding, returning empty context');
        return 'No relevant context found.';
      }

      // Search the vector index (vectra requires both vector and query string)
      const results = await this.vectorIndex.queryItems(queryEmbedding, query, topK);

      if (!results || results.length === 0) {
        console.log('📭 [SEMANTIC_SEARCH] No results found');
        return 'No relevant context found.';
      }

      console.log(`✅ [SEMANTIC_SEARCH] Found ${results.length} relevant files`);

      // Format results into context string
      let context = '';
      for (const result of results) {
        const filePath = result.item.metadata.filePath as string;
        const cachedFile = this.cache.get(filePath);
        
        if (cachedFile) {
          const score = (result.score * 100).toFixed(1);
          console.log(`   📄 ${filePath} (relevance: ${score}%)`);
          context += `\n\n--- START FILE: ${filePath} ---\n${cachedFile.content}\n--- END FILE: ${filePath} ---\n`;
        }
      }

      return context || 'No relevant context found.';
    } catch (error) {
      console.error('❌ [SEMANTIC_SEARCH] Error during semantic search:', error);
      return 'No relevant context found.';
    }
  }
}

// Export singleton instance
export const fileCache = new FileCache();
