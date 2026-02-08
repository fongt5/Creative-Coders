import dotenv from 'dotenv';
import fs from 'fs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
// Load .env from project root or js folder
const envPaths = [path.join(projectRoot, '.env'), path.join(__dirname, '.env')];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    const raw = fs.readFileSync(p, 'utf8').replace(/\r/g, '').replace(/^\uFEFF/, '');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(GEMINI_API_KEY|GOOGLE_API_KEY|API_KEY)\s*=\s*(.+)$/);
      if (m) {
        const val = m[2].replace(/^["']|["']\s*$/g, '').trim();
        if (val) process.env[m[1]] = val;
      }
    }
  }
}

const app = express();
app.use(express.json({ limit: '20mb' }));

// Support GEMINI_API_KEY, GOOGLE_API_KEY, or API_KEY
const apiKey = (
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.API_KEY ||
  ''
).trim().replace(/\s+/g, '');

if (!apiKey) {
  console.warn('Warning: API key not set. Create .env in project root with: GEMINI_API_KEY=your_key');
} else {
  console.log('API key loaded (' + apiKey.length + ' chars)');
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
