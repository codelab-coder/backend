import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
VERIFY_TOKEN=EAAT1N2TvXJ8BQ3z5F5fTkRn0GwWUtK1Tx2YmoRAefcFAlPZCQmepBVV5Pr3o0Ahjm67jbZA6iVqQFTbLWg8ZA5x3DaRl4boY5NSU7TWNCMGuLjlZAubGffaZB4HHllmZAOKJolIvzYUP7GMOsJHYULZCS6uiPGcf21FjQmpkxSup21tItMlj1o9qhgdGgDRP9CZBBDxGH2FIanjklWxZAt99iCEp6azOgXPkhHVkJTJmvptOZBZAemi8f8a1FRvfwnZAhb85RPkRxQzZAuPJOlC0G5Mkp8qMM
WHATSAPP_TOKEN=1895972641042576
PHONE_NUMBER_ID=1015197901676770

/* =========================
   Rota raiz (status)
========================= */
app.get("/", (req, res) => {
  res.send("MedHelper Backend Online");
});

/* =========================
   Verificação do Webhook
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/* =========================
   Receber mensagens
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      const message =
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      if (message) {
        const from = message.from;
        const text = message.text?.body;

        console.log("Mensagem recebida:", text);

        // Resposta automática simples
        await sendMessage(from, `Você disse: ${text}`);
      }

      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("Erro:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

/* =========================
   Enviar mensagem manual
========================= */
app.post("/send", async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!number || !message) {
      return res.status(400).json({
        status: "Número e mensagem são obrigatórios."
      });
    }

    await sendMessage(number, message);

    res.json({
      status: "Mensagem enviada com sucesso!"
    });
  } catch (error) {
    console.error("Erro ao enviar:", error.response?.data || error.message);
    res.status(500).json({
      status: "Erro ao enviar mensagem."
    });
  }
});

/* =========================
   Função de envio
========================= */
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});