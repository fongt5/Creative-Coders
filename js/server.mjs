import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const app = express();
app.use(express.json({ limit: '20mb' }));

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY not set. Set it to run the feedback API.');
}

/** Parse data URL to { mimeType, data (base64) } */
function parseDataUrl(dataUrl) {
  const match = dataUrl && dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

app.post('/api/feedback', async (req, res) => {
  if (!apiKey) {
    return res.status(503).json({ error: 'Server missing GEMINI_API_KEY' });
  }
  const { referenceImage, artworkImage } = req.body || {};
  const ref = parseDataUrl(referenceImage);
  const art = parseDataUrl(artworkImage);
  if (!ref || !art) {
    return res.status(400).json({ error: 'referenceImage and artworkImage (data URLs) required' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are an expert art teacher. You have been given two images:
1) A reference / inspiration image.
2) The user's drawing (their artwork).

Compare the reference image to the drawing. Provide detailed feedback on the drawing: what is done well, and specific improvements for drawing techniques (e.g. proportion, shading, line work, composition, accuracy relative to the reference). Be constructive and encouraging. Write your feedback in clear paragraphs.`;

    const contents = [
      { inlineData: { mimeType: ref.mimeType, data: ref.data } },
      { inlineData: { mimeType: art.mimeType, data: art.data } },
      { text: prompt },
    ];

    const response = await ai.models.generateContent({
      //model: 'gemini-2.5-flash-image',
      model: 'gemini-3-pro-image-preview',
      contents,
    });
    // or use gemini-3-pro-image
    //'gemini-2.5-flash-image'

    const text = response?.text ?? (response?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text) ?? '';
    if (!text) {
      return res.status(502).json({ error: 'No text in Gemini response', raw: response });
    }
    res.json({ feedback: text });
  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({
      error: err?.message || 'Feedback request failed',
    });
  }
});

app.use(express.static(projectRoot));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server at http://localhost:${PORT}`);
});
