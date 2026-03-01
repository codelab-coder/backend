import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";

dotenv.config();

/* =========================
   APP SETUP
========================= */
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json({ limit: "10kb" }));

const PORT = process.env.PORT || 3000;

const {
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  OPENAI_API_KEY,
  OPENAI_MODEL
} = process.env;

/* =========================
   VALIDACAO DE ENV
========================= */
["VERIFY_TOKEN", "WHATSAPP_TOKEN", "PHONE_NUMBER_ID"].forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Variável ausente: ${key}`);
    process.exit(1);
  }
});

/* =========================
   WHATSAPP CLIENT
========================= */
const whatsappAPI = axios.create({
  baseURL: `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}`,
  headers: {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json"
  },
  timeout: 10000
});

/* =========================
   HELPERS
========================= */
function truncate(text, max = 3500) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (_, res) => {
  res.json({
    status: "online",
    service: "MedHelper",
    uptime: process.uptime()
  });
});

/* =========================
   WEBHOOK VERIFY (META)
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔎 Webhook verify:", { mode, token });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =========================
   GUARDAS CLINICAS
========================= */
function classifyMessage(text = "") {
  const t = text.toLowerCase();

  if (/mg|ml|dose|posologia|quantos/i.test(t)) return "DOSE";
  if (/estou sentindo|tenho dor|meu filho|paciente/i.test(t)) return "PACIENTE";

  return "MEDICO";
}

/* =========================
   PROMPT MEDICO
========================= */
const SYSTEM_PROMPT = `
Você é um assistente de apoio à decisão clínica para profissionais de saúde.

Regras obrigatórias:
- NÃO diagnostica
- NÃO prescreve
- NÃO informa doses
- NÃO substitui avaliação médica
- Trabalha com hipóteses clínicas
- Usa linguagem técnica
- Destaca sinais de alarme
- Sugere apenas classes terapêuticas

Formato:
1. Síndromes compatíveis
2. Evolução clínica esperada
3. Sinais de alerta
4. Classes terapêuticas
5. Orientações
`;

/* =========================
   OPENAI CLIENT
========================= */
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

/* =========================
   FUNÇÃO AI - VERSÃO GRÁTIS
========================= */
async function generateAIReply(userMessage) {
  if (!OPENAI_API_KEY) return "Modo demonstração ativo (OpenAI desabilitado).";

  try {
    // força uso do GPT-3.5 turbo para plano gratuito
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL || "gpt-3.5-turbo",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    return response.choices?.[0]?.message?.content || "Resposta vazia.";
  } catch (err) {
    console.error("❌ Erro OpenAI completo:", err);

    // fallback amigável para plano gratuito
    if (err?.code === "insufficient_quota") {
      return "🚨 Limite gratuito da OpenAI atingido — resposta padrão: tente novamente mais tarde.";
    }

    return "Erro ao gerar resposta clínica.";
  }
}

/* =========================
   SEND MESSAGE (WHATSAPP)
========================= */
async function sendMessage(to, text) {
  try {
    await whatsappAPI.post("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: truncate(text) }
    });
  } catch (err) {
    console.error("❌ Erro WhatsApp:", err.response?.data || err.message);
    throw err;
  }
}

/* =========================
   ROTA PARA FRONTEND
========================= */
app.post("/send", async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!number || !message?.trim()) {
      return res.status(400).json({ error: "Número e mensagem são obrigatórios" });
    }

    const type = classifyMessage(message);

    if (type === "PACIENTE") {
      return res.json({ reply: "Canal exclusivo para profissionais de saúde." });
    }

    if (type === "DOSE") {
      return res.json({ reply: "Não posso informar doses. Posso discutir classes terapêuticas." });
    }

    const aiReply = truncate(await generateAIReply(message));

    await sendMessage(number, aiReply);

    res.json({ ok: true, reply: aiReply });
  } catch (err) {
    console.error("❌ Erro /send:", err.response?.data || err.message);
    res.status(500).json({ error: "Falha ao enviar mensagem", details: err.response?.data || err.message });
  }
});

/* =========================
   WEBHOOK RECEIVE (WHATSAPP)
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message?.text?.body) return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    console.log("📩 Mensagem recebida:", text);

    const type = classifyMessage(text);

    if (type !== "MEDICO") {
      await sendMessage(from, "Canal exclusivo para discussão clínica profissional.");
      return res.sendStatus(200);
    }

    const reply = truncate(await generateAIReply(text));
    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro webhook:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`🚀 MedHelper rodando na porta ${PORT}`);
});