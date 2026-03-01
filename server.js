import axios from "axios";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10kb" }));

/* =========================
   CONFIGURAÇÕES
========================= */
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* =========================
   VALIDAÇÃO DE ENV
========================= */
function validateEnv() {
  const required = ["VERIFY_TOKEN", "WHATSAPP_TOKEN", "PHONE_NUMBER_ID"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    console.error("Variáveis obrigatórias ausentes:", missing);
    process.exit(1);
  }
}

validateEnv();

/* =========================
   AXIOS INSTANCE SEGURA
========================= */
const whatsappAPI = axios.create({
  baseURL: `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}`,
  headers: {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 8000,
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "MedHelper Backend",
    uptime: process.uptime(),
  });
});

/* =========================
   VERIFICAÇÃO DO WEBHOOK
========================= */
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =========================
   RECEBER MENSAGENS
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();
    if (!text) return res.sendStatus(200);

    console.log(`Mensagem recebida de ${from}: ${text}`);

    const reply = await generateReply(text);
    await sendMessage(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error.message);
    return res.sendStatus(500);
  }
});

/* =========================
   ENVIO MANUAL DE MENSAGENS
========================= */
app.post("/send", async (req, res) => {
  try {
    const { number, message } = req.body;
    if (!number || !message) {
      return res.status(400).json({ error: "Número e mensagem são obrigatórios" });
    }

    await sendMessage(number, message);
    return res.json({ status: "Mensagem enviada" });
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error.message);
    return res.status(500).json({ error: "Falha no envio" });
  }
});

/* =========================
   FUNÇÃO DE ENVIO
========================= */
async function sendMessage(to, text) {
  try {
    await whatsappAPI.post("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    });
  } catch (error) {
    console.error("Erro WhatsApp:", error.response?.data || error.message);
    throw error;
  }
}

/* =========================
   INTEGRAÇÃO OPENAI
========================= */
async function generateReply(userMessage) {
  if (!OPENAI_API_KEY) return `Você disse: ${userMessage}`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é um assistente médico profissional e objetivo." },
          { role: "user", content: userMessage },
        ],
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    return response.data.choices?.[0]?.message?.content || "Não consegui gerar uma resposta.";
  } catch (error) {
    console.error("Erro OpenAI:", error.response?.data || error.message);
    return "Desculpe, ocorreu um erro ao processar sua mensagem.";
  }
}

/* =========================
   ERROR HANDLER GLOBAL
========================= */
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  res.status(500).json({ error: "Erro interno" });
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});