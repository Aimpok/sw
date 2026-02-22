const admin = require("firebase-admin");

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
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;

  // --- РУЧНОЙ ПАРСИНГ ТЕЛА ЗАПРОСА (на случай проблем с Vercel/Next.js) ---
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

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.error("JSON parse error:", e);
    }
  }

  body = body || {};

  // 1. ДОБАВЛЕНО ПОЛЕ type
  const { senderId, receiverId, text, type } = body;
  console.log(`[REQUEST] From: ${senderId}, To: ${receiverId}, Type: ${type}, Text: ${text}`);

  if (!senderId || !receiverId || !text) {
    return res.status(400).json({ 
      error: "Missing data in request body", 
      received: body
    });
  }

  try {
    const receiverSnap = await admin.database().ref(`/users/${receiverId}`).once('value');
    const receiver = receiverSnap.val();

    if (!receiver || !receiver.fcmToken) {
      console.log("No token for user");
      return res.status(200).json({ status: "No token" });
    }

    // --- 2. ОБНОВЛЕННАЯ ЛОГИКА ОФФЛАЙН ---
    // Если это ЗВОНОК ('call'), мы отправляем пуш ВСЕГДА, даже если юзер Online.
    // Если это ОБЫЧНОЕ сообщение, мы пропускаем пуш, если юзер Online.
    const isCall = (type === 'call');

    if (!isCall && receiver.status === "Online") {
      console.log(`User ${receiverId} is Online and type is not call. Push skipped.`);
      return res.status(200).json({ status: "User is online, push skipped" });
    }

    const senderSnap = await admin.database().ref(`/users/${senderId}`).once('value');
    const sender = senderSnap.val();
    const senderName = sender ? sender.name : "User";

    // --- 3. ОБНОВЛЕННЫЙ PAYLOAD ---
    // Добавляем 'type' в data, чтобы Android мог его считать
    const message = {
      token: receiver.fcmToken,
      data: {
        title: senderName,
        body: String(text),
        senderId: String(senderId),
        type: String(type || 'message') // Передаем тип (call или message)
      },
      android: { 
        priority: "high",
        ttl: isCall ? 0 : 2419200 // Для звонков ttl 0 (доставить мгновенно или никогда)
      }
    };

    const response = await admin.messaging().send(message);
    console.log("Push sent:", response);
    
    return res.status(200).json({ success: true, id: response });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: error.message });
  }
}
