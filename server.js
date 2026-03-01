import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

/* =========================
   APP SETUP
========================= */
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "10kb" }));

const PORT = process.env.PORT || 3000;

/* =========================
   CONFIGURAÇÕES
========================= */
const { VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
const GOOGLE_GEMINI_KEY = process.env.GOOGLE_GEMINI_KEY;

if (!GOOGLE_GEMINI_KEY) {
  console.warn("⚠️ GOOGLE_GEMINI_KEY não definido. Modo demonstração ativo.");
}

/* =========================
   VALIDAÇÃO DE ENV
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
    "Content-Type": "application/json",
  },
  timeout: 10000,
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
    uptime: process.uptime(),
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
   FUNÇÃO AI - GOOGLE GEMINI (text-bison-001)
========================= */
async function generateAIReply(userMessage) {
  if (!GOOGLE_GEMINI_KEY) return "Modo demonstração ativo (Gemini desabilitado).";

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generate?key=${GOOGLE_GEMINI_KEY}`;

    const response = await axios.post(
      url,
      {
        input: { text: SYSTEM_PROMPT + "\n\n" + userMessage },
        temperature: 0.3,
        maxOutputTokens: 500
      },
      { headers: { "Content-Type": "application/json" } }
    );

    // ✅ Aqui pegamos a resposta correta
    const candidate = response.data?.candidates?.[0];
    if (!candidate) return "Resposta vazia.";

    // Dependendo do modelo, pode estar em candidate.output[0].content ou candidate.content
    const contentArray = candidate.output || candidate.content;
    if (!contentArray || !contentArray.length) return "Resposta vazia.";

    return contentArray[0].text || contentArray[0].content || "Resposta vazia.";

  } catch (err) {
    console.error("❌ Erro Google Gemini:", err.response?.data || err.message);
    return "Erro ao gerar resposta clínica.";
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
      return res.json({
        reply: "Não posso informar doses. Posso discutir classes terapêuticas.",
      });
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