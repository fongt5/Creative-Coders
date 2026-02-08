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

**Task 1: Create an ANNOTATED version of the user's drawing (image 2).**
- **Layout:** Draw a **small RED CIRCLE** specifically around the detail you are critiquing. Then draw a **line** connecting that circle to a **text label** next to the drawing.
- **Visuals:** The circle must be RED and placed on the body.
- **Text Labels:** Number the labels (1, 2, 3...). Use ONLY short, clear labels (e.g., "1. Soften edge", "2. Darken shadow").
- **CRITICAL - NO SUMMARIES ON IMAGE:** Do **NOT** write any paragraphs, summaries, "Strengths", or "Art Critique" text blocks on the image itself. The image should **ONLY** contain the red circles, lines, and short labels. Keep the drawing clean.

**Task 2: Provide detailed written feedback.**
Return the feedback in this exact format:

**1. Overall Feedback**
[Write a detailed paragraph (4-5 sentences) summarizing the overall strengths and main areas for improvement. **Specifically discuss the gesture, muscle definition, and overall technique.** This is where the main critique belongs, NOT on the image.]

**2. Detailed Improvements by Area**
[For each numbered annotation (1, 2, 3...), write a **full, detailed paragraph** explaining the issue and the key improvement. Go into depth about the technique (e.g., anatomy, shading, lighting) and how to fix it.]
- **1. [Label Name]:** [Detailed paragraph...]
- **2. [Label Name]:** [Detailed paragraph...]
...and so on.
`;

    const contents = [
      { inlineData: { mimeType: ref.mimeType, data: ref.data } },
      { inlineData: { mimeType: art.mimeType, data: art.data } },
      { text: prompt },
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    const parts = response?.candidates?.[0]?.content?.parts ?? [];
    let text = '';
    let annotatedImage = null;

    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.inlineData) {
        const id = part.inlineData;
        let b64 = id.data;
        if (b64 != null) {
          if (typeof b64 !== 'string') {
            b64 = Buffer.isBuffer(b64) ? b64.toString('base64') : Buffer.from(b64).toString('base64');
          }
          const mime = id.mimeType || 'image/png';
          annotatedImage = `data:${mime};base64,${b64}`;
          break;
        }
      }
    }
    if (!annotatedImage && typeof response?.data === 'string') {
      annotatedImage = `data:image/png;base64,${response.data}`;
    }

    const sdkImageNote = /there are non-text parts .* in the response, returning concatenation of all text parts\.\s*Please refer to the non text parts for a full response from model\./i;
    if (text) text = text.replace(sdkImageNote, '').trim();

    if (!text && !annotatedImage) {
      return res.status(502).json({ error: 'No text or image in Gemini response', raw: response });
    }
    res.json({ feedback: text || null, annotatedImage });
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
