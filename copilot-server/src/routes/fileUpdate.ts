import { Router, Request, Response } from 'express';
import { fileCache } from '../services/fileCache';

export const fileUpdateRouter = Router();

interface FileUpdateBody {
  filePath: string;
  content: string;
  timestamp?: number;
}

/**
 * POST /api/update-file
 * Receives file updates from the CLI watcher
 */
fileUpdateRouter.post('/update-file', async (req: Request, res: Response) => {
  try {
    const { filePath, content, timestamp } = req.body as FileUpdateBody;

    if (!filePath || content === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: filePath and content'
      });
    }

    // Update file cache (with async embedding generation)
    await fileCache.set(filePath, {
      content,
      lastModified: timestamp || Date.now()
    });

    console.log(`📝 File updated: ${filePath} (${content.length} bytes)`);

    try {
      res.json({
        success: true,
        filePath,
        cacheSize: fileCache.size
      });
    } catch (sendError) {
      console.error('❌ [HTTP SEND ERROR] Failed to send response:', sendError);
      // Response may have already been sent or connection closed
    }
  } catch (error) {
    console.error('Error updating file:', error);
    try {
      res.status(500).json({
        error: 'Failed to update file',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } catch (sendError) {
      console.error('❌ [HTTP SEND ERROR] Failed to send error response:', sendError);
    }
  }
});

/**
 * GET /api/files
 * Returns list of cached files
 */
fileUpdateRouter.get('/files', (req: Request, res: Response) => {
  try {
    const files = Array.from(fileCache.entries()).map(([path, data]) => ({
      path,
      size: data.content.length,
      lastModified: data.lastModified
    }));

    try {
      res.json({ files, count: files.length });
    } catch (sendError) {
      console.error('❌ [HTTP SEND ERROR] Failed to send file list response:', sendError);
    }
  } catch (error) {
    console.error('Error listing files:', error);
    try {
      res.status(500).json({
        error: 'Failed to list files',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } catch (sendError) {
      console.error('❌ [HTTP SEND ERROR] Failed to send error response:', sendError);
    }
  }
});
