import axios from "axios";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

/* =========================
   APP SETUP
========================= */
const app = express();
app.use(express.json({ limit: "10kb" }));

const PORT = process.env.PORT || 3000;
const {
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  OPENAI_API_KEY
} = process.env;

/* =========================
   VALIDACAO DE ENV
========================= */
["VERIFY_TOKEN", "WHATSAPP_TOKEN", "PHONE_NUMBER_ID"].forEach((k) => {
  if (!process.env[k]) {
    console.error(`Variável ausente: ${k}`);
    process.exit(1);
  }
});

/* =========================
   WHATSAPP CLIENT
========================= */
const whatsappAPI = axios.create({
  baseURL: `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}`,
  headers: {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json"
  },
  timeout: 8000
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (_, res) => {
  res.json({ status: "online", service: "MedHelper" });
});

/* =========================
   WEBHOOK VERIFY
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* =========================
   GUARDAS CLINICAS
========================= */
function classifyMessage(text) {
  const t = text.toLowerCase();

  if (/mg|ml|dose|posologia|quantos/i.test(t)) return "DOSE";
  if (/estou sentindo|tenho dor|meu filho|paciente sou eu/i.test(t))
    return "PACIENTE";

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

Formato da resposta:
1. Síndromes compatíveis
2. Evolução clínica esperada
3. Sinais de alerta
4. Classes terapêuticas geralmente consideradas
5. Orientações de acompanhamento
`;

/* =========================
   OPENAI
========================= */
async function generateAIReply(userMessage) {
  if (!OPENAI_API_KEY) {
    return "Modo demonstração ativo (OpenAI desabilitado).";
  }

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    }
  );

  return response.data.choices[0].message.content;
}

/* =========================
   SEND MESSAGE
========================= */
async function sendMessage(to, text) {
  await whatsappAPI.post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  });
}

/* =========================
   WEBHOOK RECEIVE
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message?.text?.body) return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    console.log(`Mensagem de ${from}: ${text}`);

    const type = classifyMessage(text);

    if (type === "PACIENTE") {
      await sendMessage(
        from,
        "Este canal é exclusivo para profissionais de saúde."
      );
      return res.sendStatus(200);
    }

    if (type === "DOSE") {
      await sendMessage(
        from,
        "Não posso informar doses ou posologia. Posso discutir classes terapêuticas e riscos."
      );
      return res.sendStatus(200);
    }

    const reply = await generateAIReply(text);
    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook:", err.message);
    res.sendStatus(500);
  }
});

/* =========================
   START
========================= */
app.listen(PORT, () =>
  console.log(`🚀 MedHelper rodando na porta ${PORT}`)
);