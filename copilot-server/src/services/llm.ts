import Anthropic from '@anthropic-ai/sdk';
import { fileCache } from './fileCache';

// TODO: Configure Anthropic API key from environment variables
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';

let anthropicClient: Anthropic | null = null;

/**
 * Initialize Anthropic client
 */
function getAnthropicClient(): Anthropic {
  if (!anthropicClient && anthropicApiKey) {
    anthropicClient = new Anthropic({
      apiKey: anthropicApiKey,
    });
  }
  
  if (!anthropicClient) {
    throw new Error('Anthropic API key not configured');
  }
  
  return anthropicClient;
}

/**
 * Get AI response from Claude with relevant file context
 * @param userMessage User's question or request
 * @returns AI-generated response
 */
export async function getClaudeResponse(userMessage: string): Promise<string> {
  try {
    const client = getAnthropicClient();

    // Extract potential keywords for context retrieval
    const keywords = extractKeywords(userMessage);
    
    // Get relevant file context from cache
    const fileContext = fileCache.getRelevantContext(keywords);

    // Build system prompt with file context
    const systemPrompt = `You are a helpful coding assistant. You have access to the user's codebase through file monitoring.

Current codebase context:
${fileContext}

Provide concise, accurate coding assistance based on the available context.`;

    // Call Claude API
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    // Extract text from response
    const textContent = response.content.find(block => block.type === 'text');
    const aiResponse = textContent && 'text' in textContent ? textContent.text : 'No response generated.';

    console.log('✨ Claude response generated:', aiResponse.substring(0, 100) + '...');
    
    return aiResponse;
    
  } catch (error) {
    console.error('Error getting Claude response:', error);
    
    // Return helpful error message
    if (error instanceof Error && error.message.includes('API key')) {
      return 'Sorry, the AI service is not configured. Please add your Anthropic API key to the .env file.';
    }
    
    throw error;
  }
}

/**
 * Extract keywords from user message for context retrieval
 * Simple implementation - can be enhanced with NLP
 */
function extractKeywords(message: string): string[] {
  // Remove common words and extract potential file/code-related terms
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
  
  const words = message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word));
  
  return words;
}

/**
 * Stream Claude response (for future enhancement)
 * TODO: Implement streaming for real-time responses
 */
export async function* streamClaudeResponse(userMessage: string): AsyncGenerator<string> {
  try {
    const client = getAnthropicClient();
    
    // TODO: Implement streaming
    // const stream = await client.messages.stream({...});
    // for await (const chunk of stream) {
    //   yield chunk;
    // }
    
    // For now, yield the complete response
    const response = await getClaudeResponse(userMessage);
    yield response;
    
  } catch (error) {
    console.error('Error streaming Claude response:', error);
    throw error;
  }
}
