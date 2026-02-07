import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: "insert_api_key_here" });

async function main() {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: "Explain how AI works in a few words",
  });
  console.log(response.text);
}

main();