const express     = require('express');
const admin       = require('firebase-admin');
const bodyParser  = require('body-parser');
const cors        = require('cors');
const path        = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// সব ফাইল (index.html, firebase-messaging-sw.js) সরাসরি ওপেন হওয়ার জন্য:
app.use(express.static(__dirname));

// ── Firebase Admin initialize ──
// আপনার Service Account Key ফাইলের নামের সাথে মিল রাখুন
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// মূল পেজে ঢুকলেই সরাসরি index.html দেখাবে
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Debug ──
app.get('/debug', (req, res) => {
  res.json({
    project_id:      serviceAccount.project_id,
    client_email:    serviceAccount.client_email,
    private_key_id:  serviceAccount.private_key_id,
    private_key_len: (serviceAccount.private_key || '').length
  });
});

// ── App Status ──
app.get('/app-status', async (req, res) => {
  const { appId } = req.query;
  if (!appId) return res.status(400).json({ success: false, error: 'valid appId required' });

  try {
    const metaDoc  = await db.collection('push_app_meta').doc(appId).get();
    const tokenSnap = await db.collection('push_tokens').doc(appId).collection('devices').get();
    res.json({
      success:      true,
      appId,
      registered:   metaDoc.exists,
      registeredAt: metaDoc.exists ? metaDoc.data().registeredAt : null,
      tokenCount:   tokenSnap.size
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Register Token (APK বা ব্রাউজার থেকে আসবে) ──
app.post('/register-token', async (req, res) => {
  const { token, appId, userAgent } = req.body;

  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  if (!appId) return res.status(400).json({ success: false, error: 'valid appId required' });

  const docId = token.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

  try {
    await db.collection('push_tokens').doc(appId).collection('devices').doc(docId).set({
      token,
      appId,
      userAgent:    userAgent || '',
      registeredAt: Date.now(),
      updatedAt:    Date.now()
    }, { merge: true });

    console.log(`[${appId}] Token registered: ${token.substring(0, 20)}...`);
    res.json({ success: true });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Send Notification ──
app.post('/send-notification', async (req, res) => {
  const { token, title, body, imageUrl } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    const message = {
      token,
      data: { 
        title: title || 'Notification', 
        body: body || '', 
        ...(imageUrl ? { imageUrl } : {}) 
      },
      android: { priority: 'high' }
    };

    const msgId = await admin.messaging().send(message);
    res.json({ success: true, messageId: msgId });
  } catch (e) {
    console.error('Send error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Send to All ──
app.post('/send-all', async (req, res) => {
  const { appId, title, body, imageUrl } = req.body;
  if (!appId) return res.status(400).json({ success: false, error: 'valid appId required' });

  try {
    const snap = await db.collection('push_tokens').doc(appId).collection('devices').get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const messages = tokens.map(token => ({
      token,
      data: { 
        title: title || 'Notification', 
        body: body || '', 
        ...(imageUrl ? { imageUrl } : {}) 
      },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    res.json({
      success:      true,
      appId,
      total:        tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`Wevlo Push Server running on port ${PORT}`));
