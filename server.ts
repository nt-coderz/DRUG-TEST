/**
 * Express Full-Stack Server for ChromaEvidence
 *
 * Provides server-side Gemini API endpoints:
 * - POST /api/gemini/chat : Multi-turn Forensic Colorimetric & Chain-of-Custody Chatbot
 *   Supports `gemini-3.1-flash-lite` (Fast), `gemini-3.8-flash` (General), and `gemini-4-argon` (Complex)
 * - POST /api/gemini/search-grounding : Google Search Grounding (`tools: [{ googleSearch: {} }]`)
 * - POST /api/gemini/maps-grounding : Google Maps Grounding (`tools: [{ googleMaps: {} }]`)
 */

import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set in the server environment. Configure GEMINI_API_KEY in AI Studio Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

const FORENSIC_SYSTEM_INSTRUCTION = `You are the ChromaEvidence Forensic Colorimetric & Chain-of-Custody Assistant.
You assist forensic field officers, evidence technicians, and laboratory analysts with:
1. Presumptive colorimetric reagent chemistry (Marquis, Scott / Cobalt Thiocyanate, Simon's, Duquenois-Levine, Mandelin, Mecke), expected reaction colors, known false-positive cross-reactivities, and reaction wait-time protocols.
2. Colorimetric calibration & CIELAB / CIEDE2000 (ΔE00) quality gates, D65 reference card illumination normalization, and interpreting ΔE00 distances.
3. Tamper-evident digital evidence procedures: SHA-256 image hashing, canonical JSON serialization, ECDSA P-256 signatures, sequential hash-chain verification, and packaging evidence for confirmatory GC-MS / LC-MS-MS laboratory submission.
Always emphasize that field colorimetric tests are PRESUMPTIVE only and require confirmatory laboratory analysis (e.g., GC-MS or LC-MS/MS) for court admissibility.`;

interface ChatTurnInput {
  role: 'user' | 'model';
  text: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 1. Multi-Turn Gemini Chatbot Endpoint
  app.post('/api/gemini/chat', async (req, res) => {
    try {
      const { messages, model: requestedModel, contextSummary } = req.body as {
        messages?: ChatTurnInput[];
        model?: string;
        contextSummary?: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages array is required.' });
        return;
      }

      const allowedModels = [
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemini-4-argon',
      ];
      const selectedModel =
        requestedModel && allowedModels.includes(requestedModel)
          ? requestedModel
          : 'gemini-3.8-flash';

      const ai = getGenAIClient();

      const systemInstruction = contextSummary
        ? `${FORENSIC_SYSTEM_INSTRUCTION}\n\nCurrent Active Evidence Log Context:\n${contextSummary}`
        : FORENSIC_SYSTEM_INSTRUCTION;

      const contents = messages.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      let activeModelUsed = selectedModel;
      let fallbackNotice: string | null = null;

      try {
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents,
          config: {
            systemInstruction,
          },
        });

        res.json({
          text: response.text ?? 'No response generated.',
          modelUsed: activeModelUsed,
          fallbackNotice,
        });
      } catch (innerErr) {
        // If user selected gemini-4-argon without a paid key, gracefully fallback to gemini-3.8-flash
        if (selectedModel === 'gemini-4-argon') {
          activeModelUsed = 'gemini-3.8-flash';
          fallbackNotice =
            'Note: gemini-4-argon requires a paid billing key; automatically answered using gemini-3.8-flash.';
          const fallbackResponse = await ai.models.generateContent({
            model: activeModelUsed,
            contents,
            config: {
              systemInstruction,
            },
          });
          res.json({
            text: fallbackResponse.text ?? 'No response generated.',
            modelUsed: activeModelUsed,
            fallbackNotice,
          });
          return;
        }
        throw innerErr;
      }
    } catch (error) {
      console.error('Error in /api/gemini/chat:', error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to generate chat response.',
      });
    }
  });

  // 2. Google Search Grounding Endpoint (gemini-3.8-flash + googleSearch tool)
  app.post('/api/gemini/search-grounding', async (req, res) => {
    try {
      const { query } = req.body as { query?: string };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'Search query is required.' });
        return;
      }

      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Provide an accurate, forensic-grade briefing on the following colorimetric reagent or toxicology question using current literature and public health / forensic alerts:\n\n${query.trim()}`,
        config: {
          systemInstruction: FORENSIC_SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }],
        },
      });

      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources: { uri: string; title: string }[] = [];
      const seenUris: Record<string, boolean> = {};

      for (const chunk of chunks) {
        const uri = chunk.web?.uri;
        const title = chunk.web?.title || uri || 'Web Source';
        if (uri && !seenUris[uri]) {
          seenUris[uri] = true;
          sources.push({ uri, title });
        }
      }

      const webSearchQueries =
        response.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];

      res.json({
        text: response.text ?? 'No grounded response returned.',
        sources,
        webSearchQueries,
      });
    } catch (error) {
      console.error('Error in /api/gemini/search-grounding:', error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to execute Google Search Grounding request.',
      });
    }
  });

  // 3. Google Maps Grounding Endpoint (gemini-3.8-flash + googleMaps tool)
  // NOTE: Per gemini-api skill, responseMimeType and responseSchema are NOT supported with googleMaps grounding.
  app.post('/api/gemini/maps-grounding', async (req, res) => {
    try {
      const { query, lat, lng } = req.body as {
        query?: string;
        lat?: number | null;
        lng?: number | null;
      };

      if (!query || !query.trim()) {
        res.status(400).json({ error: 'Maps grounding query is required.' });
        return;
      }

      const ai = getGenAIClient();
      const hasCoords =
        typeof lat === 'number' &&
        Number.isFinite(lat) &&
        typeof lng === 'number' &&
        Number.isFinite(lng);

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: query.trim(),
        config: {
          tools: [{ googleMaps: {} }],
          ...(hasCoords
            ? {
                toolConfig: {
                  retrievalConfig: {
                    latLng: {
                      latitude: lat as number,
                      longitude: lng as number,
                    },
                  },
                },
              }
            : {}),
        },
      });

      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const places: {
        uri: string;
        title: string;
        reviewSnippets: string[];
      }[] = [];
      const seenUris: Record<string, boolean> = {};

      for (const chunk of chunks) {
        const mapsData = (
          chunk as unknown as {
            maps?: {
              uri?: string;
              title?: string;
              placeAnswerSources?: {
                reviewSnippets?: { content?: string; text?: string }[];
              };
            };
          }
        ).maps;

        if (mapsData?.uri && !seenUris[mapsData.uri]) {
          seenUris[mapsData.uri] = true;
          const snippets: string[] = [];
          const rawSnippets =
            mapsData.placeAnswerSources?.reviewSnippets ?? [];
          for (const s of rawSnippets) {
            const snippetText = s.content || s.text;
            if (snippetText) snippets.push(snippetText);
          }
          places.push({
            uri: mapsData.uri,
            title: mapsData.title || 'Google Maps Place',
            reviewSnippets: snippets,
          });
        }
      }

      res.json({
        text: response.text ?? 'No Google Maps grounded response returned.',
        places,
        usedCoordinates: hasCoords ? { lat, lng } : null,
      });
    } catch (error) {
      console.error('Error in /api/gemini/maps-grounding:', error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to execute Google Maps Grounding request.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChromaEvidence server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
