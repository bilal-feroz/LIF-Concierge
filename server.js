// server.js
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import OpenAI from 'openai';

config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 30_000, max: 60 }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are a concise, helpful, multilingual assistant for a visitor kiosk at EDGE LIF.
Always respond in the same language as the user's last message (English or Arabic).
Keep replies crisp for speech: short sentences, friendly, and contextual (directions, offices, safety notes).
If the user asks for directions, provide a brief route description.
`;

function detectLangHeuristic(text = '') {
  if (/[اأإآء-ي]/.test(text)) return 'ar';
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text)) return 'ko';
  if (/[一-龯]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr';
  if (/[äöüß]/i.test(text)) return 'de';
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es';
  if (/[ìòàéù]/i.test(text) && /[gl]li|che|per\\b/i.test(text)) return 'it';
  return 'en';
}

app.post('/api/chat', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...incoming].slice(-12);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',   // choose a current small fast chat model
      temperature: 0.4,
      messages
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || '';
    res.json({ reply, lang: detectLangHeuristic(reply) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chat backend error' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Voice chat API listening on port', process.env.PORT || 3000);
});
