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
 * @param fileContext Optional file context to provide to Claude
 * @returns AI-generated response
 */
export async function getClaudeResponse(userMessage: string, fileContext?: string): Promise<string> {
  try {
    const client = getAnthropicClient();

    // If fileContext not provided, get it from cache using semantic search
    let contextToUse = fileContext;
    if (!contextToUse) {
      contextToUse = await fileCache.searchSemanticContext(userMessage, 5);
    }

    // Build conversational system prompt
    const systemPrompt = `You are an AI code co-pilot providing quick, conversational updates. When asked about code changes or file contents based on the provided context, respond like you're briefing a colleague. Be concise (1-3 sentences if possible), focus on the main point, and use natural language. Avoid lists or overly formal explanations unless specifically asked. If no file context is provided or relevant, state that clearly but politely.`;

    // Call Claude API
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 300,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          // Prepend context clearly for the model
          content: `Context provided:\n${contextToUse}\n\nUser query: ${userMessage}`,
        },
      ],
    });

    // Extract text from response
    const textContent = response.content.find(block => block.type === 'text');
    const aiResponse = textContent && 'text' in textContent ? textContent.text : 'No response generated.';

    console.log('✨ Claude response generated:', aiResponse.substring(0, 100) + '...');
    
    return aiResponse;
    
  } catch (error) {
    // Enhanced error logging for debugging
    console.error('Error getting Claude response:', error);
    
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    
    // Return helpful error message
    if (error instanceof Error && error.message.includes('API key')) {
      return 'Sorry, the AI service is not configured. Please add your Anthropic API key to the .env file.';
    }
    
    throw error;
  }
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
