/**
 * In-memory file cache
 * Stores file content received from the CLI watcher
 */

interface CachedFile {
  content: string;
  lastModified: number;
}

export class FileCache {
  private cache: Map<string, CachedFile>;

  constructor() {
    this.cache = new Map();
  }

  set(filePath: string, data: CachedFile): void {
    this.cache.set(filePath, data);
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
   * Get relevant context for Claude based on current conversation
   */
  getRelevantContext(keywords: string[]): string {
    let context = '';
    let fileCount = 0;

    for (const [path, data] of this.cache.entries()) {
      // Simple relevance check - can be improved with semantic search
      const isRelevant = keywords.some(keyword => 
        path.toLowerCase().includes(keyword.toLowerCase()) ||
        data.content.toLowerCase().includes(keyword.toLowerCase())
      );

      if (isRelevant && fileCount < 10) { // Limit context size
        context += `\n\n--- File: ${path} ---\n${data.content}\n`;
        fileCount++;
      }
    }

    return context || 'No relevant files in cache.';
  }
}

// Export singleton instance
export const fileCache = new FileCache();
