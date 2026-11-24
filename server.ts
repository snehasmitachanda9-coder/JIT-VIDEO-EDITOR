import 'dotenv/config';
import express from 'express';
import type {Request, Response} from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GoogleGenAI, Type} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface StudioRequestBody {
  topic?: string;
  clipNames?: string[];
  durationSeconds?: number;
  aspectRatio?: string;
  tone?: string;
  frameDataUrl?: string;
}

const app = express();
app.use(express.json({limit: '4mb'}));

app.post('/api/gemini/studio', async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.',
    });
    return;
  }

  try {
    const body = (req.body || {}) as StudioRequestBody;
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    const clipNames = Array.isArray(body.clipNames)
      ? body.clipNames.filter((n): n is string => typeof n === 'string').slice(0, 10)
      : [];
    const durationSeconds =
      typeof body.durationSeconds === 'number' && body.durationSeconds > 0
        ? Math.min(Math.round(body.durationSeconds), 3600)
        : 15;
    const aspectRatio =
      typeof body.aspectRatio === 'string' ? body.aspectRatio : '16:9';
    const tone = typeof body.tone === 'string' ? body.tone : 'Engaging';
    const frameDataUrl =
      typeof body.frameDataUrl === 'string' ? body.frameDataUrl : '';

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const promptText = [
      `You are an expert video content strategist and social media editor.`,
      `Generate viral packaging and timestamped video captions for an edited video.`,
      `Context:`,
      `- Topic / notes: ${topic || 'Infer from the clip filenames and visual frame if provided'}`,
      `- Source clip filenames: ${clipNames.length > 0 ? clipNames.join(', ') : 'Untitled clip'}`,
      `- Target aspect ratio: ${aspectRatio}`,
      `- Total video duration: ${durationSeconds.toFixed(1)} seconds`,
      `- Desired tone: ${tone}`,
      ``,
      `Requirements:`,
      `1. Provide 3 punchy, high-retention viral titles.`,
      `2. Provide 1 concise, engaging video description (2-3 sentences).`,
      `3. Provide 6 to 8 relevant hashtags (each starting with #).`,
      `4. Provide 4 to 6 timestamped captions spanning between 0 and ${durationSeconds.toFixed(1)} seconds, with non-overlapping startTime and endTime (each caption short enough to read cleanly as an on-screen text overlay, 3-7 words each).`,
    ].join('\n');

    const parts: Array<
      | {text: string}
      | {inlineData: {mimeType: string; data: string}}
    > = [];

    const dataUrlMatch = frameDataUrl.match(
      /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
    );
    if (dataUrlMatch) {
      parts.push({
        inlineData: {
          mimeType: dataUrlMatch[1],
          data: dataUrlMatch[2],
        },
      });
    }

    parts.push({text: promptText});

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {parts},
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titles: {
              type: Type.ARRAY,
              items: {type: Type.STRING},
              description: 'Three catchy viral title ideas.',
            },
            description: {
              type: Type.STRING,
              description: 'Short engaging video description.',
            },
            hashtags: {
              type: Type.ARRAY,
              items: {type: Type.STRING},
              description: 'Relevant hashtags starting with #.',
            },
            captions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startTime: {type: Type.NUMBER},
                  endTime: {type: Type.NUMBER},
                  text: {type: Type.STRING},
                },
                required: ['startTime', 'endTime', 'text'],
              },
              description: 'Timestamped on-screen captions within the video duration.',
            },
          },
          required: ['titles', 'description', 'hashtags', 'captions'],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      res.status(502).json({error: 'Empty response returned from Gemini API.'});
      return;
    }

    const parsed = JSON.parse(rawText);
    res.json(parsed);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate AI Studio content.';
    res.status(500).json({error: message});
  }
});

async function startServer() {
  if (!isProduction) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JIT Video Editor server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
