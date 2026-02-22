const admin = require("firebase-admin");

// Инициализация Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

export default async function handler(req, res) {
  // Настройки CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Отвечаем на preflight-запросы
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;

  // --- ИСПРАВЛЕНИЕ: ЖЕСТКИЙ ПАРСИНГ BODY ---
  // 1. Если Vercel вообще не собрал body (бывает, если Content-Type чуть не совпал)
  if (!body || Object.keys(body).length === 0) {
    try {
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      const rawBody = Buffer.concat(buffers).toString();
      if (rawBody) {
        body = JSON.parse(rawBody);
      }
    } catch (e) {
      console.error("Manual stream parse error:", e);
    }
  }

  // 2. Если body пришло как строка (стандартная проблема Vercel)
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.error("JSON parse error:", e);
    }
  }

  // Защита от краша, если всё равно ничего нет
  body = body || {};

  const { senderId, receiverId, text } = body;
  console.log(`[REQUEST] From: ${senderId}, To: ${receiverId}, Text: ${text}`);

  // Проверка на наличие нужных данных
  if (!senderId || !receiverId || !text) {
    return res.status(400).json({ 
      error: "Missing data in request body", 
      received: body,
      typeOfBody: typeof body
    });
  }

  // --- ОТПРАВКА ПУША ---
  try {
    // Получаем токен получателя
    const receiverSnap = await admin.database().ref(`/users/${receiverId}`).once('value');
    const receiver = receiverSnap.val();

    if (!receiver || !receiver.fcmToken) {
      console.log("No token for user");
      return res.status(200).json({ status: "No token" });
    }

    // Получаем имя отправителя для заголовка
    const senderSnap = await admin.database().ref(`/users/${senderId}`).once('value');
    const sender = senderSnap.val();
    const senderName = sender ? sender.name : "New Message";

    // Формируем сообщение (используем data payload для работы в фоне)
    const message = {
      token: receiver.fcmToken,
      data: {
        title: senderName,
        body: String(text), // На всякий случай кастуем в строку
        senderId: String(senderId)
      },
      android: { priority: "high" }
    };

    // Отправляем
    const response = await admin.messaging().send(message);
    console.log("Push sent:", response);
    
    return res.status(200).json({ success: true, id: response });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: error.message });
  }
}
