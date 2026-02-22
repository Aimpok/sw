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
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- ИСПРАВЛЕНИЕ ОШИБКИ: Безопасное чтение body ---
  let body = req.body;
  
  // Если body пришло как строка (иногда бывает в Vercel), парсим вручную
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.error("JSON parse error:", e);
    }
  }
  
  // Если body вообще нет, создаем пустой объект, чтобы не было краша
  body = body || {};

  const { senderId, receiverId, text } = body;
  console.log(`[REQUEST] From: ${senderId}, To: ${receiverId}, Text: ${text}`);

  if (!senderId || !receiverId || !text) {
    return res.status(400).json({ error: "Missing data in request body", received: body });
  }

  try {
    const receiverSnap = await admin.database().ref(`/users/${receiverId}`).once('value');
    const receiver = receiverSnap.val();

    if (!receiver || !receiver.fcmToken) {
      console.log("No token for user");
      return res.status(200).json({ status: "No token" });
    }

    const senderSnap = await admin.database().ref(`/users/${senderId}`).once('value');
    const sender = senderSnap.val();
    const senderName = sender ? sender.name : "New Message";

    const message = {
      token: receiver.fcmToken,
      data: {
        title: senderName,
        body: text,
        senderId: senderId
      },
      android: { priority: "high" }
    };

    const response = await admin.messaging().send(message);
    console.log("Push sent:", response);
    
    return res.status(200).json({ success: true, id: response });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: error.message });
  }
}
