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
    
    // Prompt for text feedback (using gemini-2.5-flash-image)
    const textPrompt = `You are an expert art teacher. You have been given two images:
1) A reference / inspiration image.
2) The user's drawing (their artwork).

Analyze the user's drawing and provide detailed written feedback. Identify 3-5 specific areas for improvement.

Return the feedback in this exact format:

**Overall Feedback**
[Write a detailed paragraph (4-5 sentences) summarizing the overall strengths and main areas for improvement. **Specifically discuss the gesture, muscle definition, and overall technique.**]

**Detailed Improvements by Area**
[For each area, write a **full, detailed paragraph** explaining the issue and the key improvement. Go into depth about the technique (e.g., anatomy, shading, lighting) and how to fix it. Use layman's terms, not anatomy jargon.]
- **[Area Name]:** [Detailed paragraph explaining the issue, why it matters, and actionable steps to improve...]
- **[Area Name]:** [Detailed paragraph explaining the issue, why it matters, and actionable steps to improve...]
...and so on for each area.
`;

    const contentsForText = [
      { inlineData: { mimeType: ref.mimeType, data: ref.data } },
      { inlineData: { mimeType: art.mimeType, data: art.data } },
      { text: textPrompt },
    ];

    // First, get the text feedback
    console.log('Sending request to Gemini API for text feedback...');
    const textResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: contentsForText,
      config: { responseModalities: ['TEXT'] },
    });
    console.log('Received text response from Gemini API');

    // Extract text and parse numbered areas
    let text = '';
    const textParts = textResponse?.candidates?.[0]?.content?.parts ?? [];
    
    for (const part of textParts) {
      if (part.text) {
        text += part.text;
      }
    }
    
    if (!text) {
      if (textResponse?.candidates?.[0]?.content?.text) {
        text = textResponse.candidates[0].content.text;
      } else if (textResponse?.text) {
        text = textResponse.text;
      }
    }

    // Extract numbered areas from the text feedback
    // First, try to find the "Detailed Improvements by Area" section
    const improvementsSectionMatch = text.match(/\*\*2\.\s*Detailed Improvements by Area\*\*([\s\S]*?)(?=\*\*|$)/i);
    const sectionToParse = improvementsSectionMatch ? improvementsSectionMatch[1] : text;
    
    const numberedAreas = [];
    // Try multiple regex patterns to catch different formats, prioritizing the improvements section
    const areaPatterns = [
      /-?\s*\*\*(\d+)\.\s*([^*]+?):\*\*/g,  // **1. Label:**
      /-?\s*\*\*(\d+)\.\s*([^*]+?)\*\*/g,   // **1. Label**
      /-?\s*(\d+)\.\s*\*\*([^*]+?):\*\*/g,   // 1. **Label:**
      /-?\s*(\d+)\.\s*\*\*([^*]+?)\*\*/g,    // 1. **Label**
      /-?\s*(\d+)\.\s*([^\n:]+?):/g,         // 1. Label:
      /-?\s*(\d+)\.\s*([^\n]+?)(?:\n|$)/g    // 1. Label (end of line)
    ];
    
    for (const pattern of areaPatterns) {
      let match;
      pattern.lastIndex = 0; // Reset regex
      while ((match = pattern.exec(sectionToParse)) !== null) {
        const num = parseInt(match[1]);
        let label = match[2].trim().replace(/^\*\*|\*\*$/g, ''); // Remove markdown bold
        // Clean up label - remove trailing colons, extra spaces
        label = label.replace(/:\s*$/, '').trim();
        // Only add if we don't already have this number
        if (!numberedAreas.find(a => a.number === num) && label.length > 0) {
          numberedAreas.push({ number: num, label });
        }
      }
      if (numberedAreas.length > 0) break; // Stop if we found matches
    }
    
    // Sort by number to ensure correct order
    numberedAreas.sort((a, b) => a.number - b.number);
    
    console.log(`Found ${numberedAreas.length} numbered areas:`, numberedAreas);
    console.log('Extracted labels:', numberedAreas.map(a => `${a.number}. ${a.label}`).join(', '));

    // Build image prompt with the numbered areas from text feedback
    let imagePrompt = `You are an expert art teacher. You have been given two images:
1) A reference / inspiration image.
2) The user's drawing (their artwork).

**CRITICAL: For the output image, you MUST copy image 2 (the user's drawing) pixel-for-pixel and ONLY add red annotation markers on top. Do NOT redraw, recreate, or modify the drawing in any way.**

Create an annotated version of image 2`;

    if (numberedAreas.length > 0) {
      imagePrompt += ` with EXACTLY ${numberedAreas.length} numbered annotations. The numbers and labels MUST match the text feedback in this EXACT order:

`;

      // Add the numbered areas to the prompt in a very explicit format
      for (const area of numberedAreas) {
        imagePrompt += `Annotation ${area.number}: "${area.number}. ${area.label}" - Place a red circle on this specific area.\n`;
      }

      imagePrompt += `
**CRITICAL NUMBERING REQUIREMENTS:**
- You MUST create exactly ${numberedAreas.length} annotations.
- The annotations MUST be numbered ${numberedAreas.map(a => a.number).join(', ')} in this EXACT order.
- The labels MUST be exactly: "${numberedAreas.map(a => `${a.number}. ${a.label}`).join('", "')}"
- Do NOT skip numbers. Do NOT change the order. Do NOT use different labels.

**Steps to create the annotated image:**
- **Step 1:** Copy image 2 exactly as it appears - same lines, same shading, same proportions, same style. The drawing must be IDENTICAL.
- **Step 2:** On top of this exact copy, add small RED circles (about 20-30 pixels in diameter) directly on the specific body parts. Add them in this exact order: ${numberedAreas.map(a => `#${a.number} "${a.label}"`).join(', then ')}.
- **Step 3:** Draw thin RED lines from each circle to a numbered text label placed outside the drawing area.
- **Circle placement:** Place each red circle precisely on the actual body part being critiqued. The circle should be small enough to highlight just that specific area, not the entire body.
- **Text Labels:** For each annotation, use the EXACT format shown above. Label #1 must say "${numberedAreas[0].number}. ${numberedAreas[0].label}", Label #2 must say "${numberedAreas.length > 1 ? `${numberedAreas[1].number}. ${numberedAreas[1].label}` : 'N/A'}", etc. Place labels in empty space around the drawing, connected by lines.
- **What NOT to do:** Do NOT redraw the image. Do NOT change the drawing style. Do NOT add paragraphs or summaries on the image. Do NOT make large circles that cover multiple body parts. Do NOT change the order, numbers, or labels of the annotations. Do NOT add extra annotations or skip any numbers.
`;
    } else {
      // Fallback if no numbered areas found
      imagePrompt += `:
- **Step 1:** Copy image 2 exactly as it appears - same lines, same shading, same proportions, same style. The drawing must be IDENTICAL.
- **Step 2:** On top of this exact copy, add small RED circles (about 20-30 pixels in diameter) directly on the specific body parts you want to critique.
- **Step 3:** Draw thin RED lines from each circle to a numbered text label placed outside the drawing area.
- **Circle placement:** Place each red circle precisely on the actual body part being critiqued. The circle should be small enough to highlight just that specific area, not the entire body.
- **Text Labels:** Use format "1. [short label]", "2. [short label]", etc. Place labels in empty space around the drawing, connected by lines.
- **What NOT to do:** Do NOT redraw the image. Do NOT change the drawing style. Do NOT add paragraphs or summaries on the image. Do NOT make large circles that cover multiple body parts.
`;
    }

    const contentsForImage = [
      { inlineData: { mimeType: ref.mimeType, data: ref.data } },
      { inlineData: { mimeType: art.mimeType, data: art.data } },
      { text: imagePrompt },
    ];

    // Now get the annotated image
    console.log('Sending request to Gemini API for annotated image...');
    const imageResponse = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: contentsForImage,
      config: { responseModalities: ['IMAGE'] },
    });
    console.log('Received image response from Gemini API');

    // Extract image from imageResponse
    let annotatedImage = null;
    const imageParts = imageResponse?.candidates?.[0]?.content?.parts ?? [];
    console.log(`Image response has ${imageParts.length} parts`);

    for (const part of imageParts) {
      if (part.inlineData) {
        const id = part.inlineData;
        let b64 = id.data;
        if (b64 != null) {
          if (typeof b64 !== 'string') {
            b64 = Buffer.isBuffer(b64) ? b64.toString('base64') : Buffer.from(b64).toString('base64');
          }
          const mime = id.mimeType || 'image/png';
          annotatedImage = `data:${mime};base64,${b64}`;
          console.log('Found image part');
          break;
        }
      }
    }
    
    if (!annotatedImage && typeof imageResponse?.data === 'string') {
      annotatedImage = `data:image/png;base64,${imageResponse.data}`;
      console.log('Found image in imageResponse.data');
    }

    const sdkImageNote = /there are non-text parts .* in the response, returning concatenation of all text parts\.\s*Please refer to the non text parts for a full response from model\./i;
    if (text) text = text.replace(sdkImageNote, '').trim();

    console.log(`Final: text length=${text.length}, hasImage=${!!annotatedImage}`);
    console.log('Text preview:', text.substring(0, 200));

    if (!text && !annotatedImage) {
      console.error('No text or image in responses');
      return res.status(502).json({ error: 'No text or image in Gemini responses' });
    }
    
    const responseData = { 
      feedback: text || null, 
      annotatedImage: annotatedImage || null 
    };
    console.log('Sending response:', {
      feedbackLength: responseData.feedback?.length || 0,
      hasAnnotatedImage: !!responseData.annotatedImage,
      annotatedImagePreview: responseData.annotatedImage?.substring(0, 50) || 'none'
    });
    res.json(responseData);
  } catch (err) {
    console.error('Gemini error:', err);
    console.error('Error details:', err.stack);
    res.status(500).json({
      error: err?.message || 'Feedback request failed',
      details: err.toString(),
    });
  }
});

app.use(express.static(projectRoot));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server at http://localhost:${PORT}`);
});
