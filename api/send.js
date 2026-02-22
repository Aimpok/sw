const admin = require("firebase-admin");

// Инициализируем Firebase только один раз
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel иногда ломает переносы строк в ключах, этот фикс всё чинит:
      privateKey: process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

export default async function handler(req, res) {
  // Разрешаем CORS (чтобы запросы с телефона проходили)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { senderId, receiverId, text } = req.body;

  if (!senderId || !receiverId || !text) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    // 1. Ищем токен получателя
    const receiverSnap = await admin.database().ref(`/users/${receiverId}`).once('value');
    const receiver = receiverSnap.val();

    if (!receiver || !receiver.fcmToken) {
      return res.status(200).json({ status: "No token" });
    }

    // Если юзер онлайн - не шлем (опционально)
    if (receiver.status === "Online") {
      return res.status(200).json({ status: "User online" });
    }

    // 2. Ищем имя отправителя
    const senderSnap = await admin.database().ref(`/users/${senderId}`).once('value');
    const sender = senderSnap.val();
    const senderName = sender ? sender.name : "New Message";

    // 3. Шлем пуш
    const message = {
      token: receiver.fcmToken,
      data: {
        title: senderName,
        body: text,
        senderId: senderId
      },
      android: {
        priority: "high"
      }
    };

    await admin.messaging().send(message);
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Firebase error:", error);
    return res.status(500).json({ error: error.message });
  }
}
