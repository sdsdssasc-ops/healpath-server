const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'healpath-secret-key-2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/videos', express.static('public/videos'));

// ===== ملفات JSON كقاعدة بيانات =====
const DATA_DIR = './data';
const USERS_FILE = `${DATA_DIR}/users.json`;
const CHATS_FILE = `${DATA_DIR}/chats.json`;
const TICKETS_FILE = `${DATA_DIR}/tickets.json`;
const VIDEOS_FILE = `${DATA_DIR}/videos.json`;
const NOTIFICATIONS_FILE = `${DATA_DIR}/notifications.json`;

function initDataFiles() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    [USERS_FILE, CHATS_FILE, TICKETS_FILE, VIDEOS_FILE, NOTIFICATIONS_FILE].forEach(file => {
        if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify([]));
    });
}
initDataFiles();

function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } 
    catch { return []; }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===== Multer لرفع الفيديوهات =====
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'public/videos';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) cb(null, true);
        else cb(new Error('ملف غير مدعوم. يرجى رفع فيديو فقط.'));
    }
});

// ===== Middleware المصادقة =====
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch { res.status(401).json({ error: 'توكن غير صالح' }); }
}

// ===== API: تسجيل =====
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'اسم المستخدم مستخدم' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        daysRecovery: 0,
        videosWatched: 0,
        supportChats: 0,
        streak: 0,
        lastVisit: null
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    
    const chats = readJSON(CHATS_FILE);
    chats.push({ userId: newUser.id, messages: [{ type: 'system', text: '👋 مرحباً! كيف يمكننا مساعدتك اليوم؟', time: new Date().toISOString() }] });
    writeJSON(CHATS_FILE, chats);
    
    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET);
    res.json({ token, user: { id: newUser.id, username: newUser.username } });
});

// ===== API: تسجيل دخول =====
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'المستخدم غير موجود' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });
    
    const today = new Date().toDateString();
    const lastVisit = user.lastVisit;
    if (lastVisit !== today) {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        if (lastVisit === yesterday.toDateString()) user.streak = (user.streak || 0) + 1;
        else user.streak = 1;
        user.lastVisit = today;
        writeJSON(USERS_FILE, users);
    }
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({ 
        token, 
        user: { 
            id: user.id, 
            username: user.username, 
            daysRecovery: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000*60*60*24)),
            videosWatched: user.videosWatched || 0,
            supportChats: user.supportChats || 0,
            streak: user.streak || 0
        } 
    });
});

// ===== API: بيانات المستخدم =====
app.get('/api/me', authMiddleware, (req, res) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({
        id: user.id,
        username: user.username,
        daysRecovery: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000*60*60*24)),
        videosWatched: user.videosWatched || 0,
        supportChats: user.supportChats || 0,
        streak: user.streak || 0
    });
});

// ===== API: المحادثة =====
app.get('/api/chat', authMiddleware, (req, res) => {
    const chats = readJSON(CHATS_FILE);
    const chat = chats.find(c => c.userId === req.user.id);
    res.json(chat ? chat.messages : []);
});

app.post('/api/chat', authMiddleware, (req, res) => {
    const { text } = req.body;
    const chats = readJSON(CHATS_FILE);
    let chat = chats.find(c => c.userId === req.user.id);
    if (!chat) { chat = { userId: req.user.id, messages: [] }; chats.push(chat); }
    
    const msg = { type: 'sent', text, time: new Date().toISOString() };
    chat.messages.push(msg);
    
    const replies = [
        'شكراً لتواصلك معنا! فريق الدعم سيقوم بالرد عليك قريباً.',
        'نقدر ثقتك بنا. نحن هنا لمساعدتك في أي وقت.',
        'تم استلام رسالتك. سيتواصل معك أحد المختصين قريباً.',
        'نحن معك في كل خطوة. استمر! 💪'
    ];
    const reply = { type: 'received', text: replies[Math.floor(Math.random() * replies.length)], time: new Date().toISOString() };
    chat.messages.push(reply);
    
    writeJSON(CHATS_FILE, chats);
    
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (user) { user.supportChats = (user.supportChats || 0) + 1; writeJSON(USERS_FILE, users); }
    
    res.json({ messages: chat.messages });
});

// ===== API: الدعم الفني =====
app.get('/api/tickets', authMiddleware, (req, res) => {
    const tickets = readJSON(TICKETS_FILE).filter(t => t.userId === req.user.id);
    res.json(tickets);
});

app.post('/api/tickets', authMiddleware, (req, res) => {
    const { type, subject, details } = req.body;
    const tickets = readJSON(TICKETS_FILE);
    const ticket = {
        id: Date.now().toString(),
        userId: req.user.id,
        type, subject, details,
        status: 'pending',
        date: new Date().toISOString()
    };
    tickets.push(ticket);
    writeJSON(TICKETS_FILE, tickets);
    res.json(ticket);
});

// ===== API: الفيديوهات =====
app.get('/api/videos', (req, res) => {
    const videos = readJSON(VIDEOS_FILE);
    res.json(videos);
});

app.post('/api/videos', authMiddleware, upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع الفيديو' });
    
    const videos = readJSON(VIDEOS_FILE);
    const newVideo = {
        id: Date.now().toString(),
        title: req.body.title || req.file.originalname.replace(/\.[^/.]+$/, ''),
        desc: req.body.desc || 'فيديو مضاف حديثاً',
        filename: req.file.filename,
        src: `/videos/${req.file.filename}`,
        duration: req.body.duration || '00:00',
        views: 0,
        uploadedBy: req.user.id,
        uploadedAt: new Date().toISOString()
    };
    videos.push(newVideo);
    writeJSON(VIDEOS_FILE, videos);
    res.json(newVideo);
});

app.post('/api/videos/:id/watch', authMiddleware, (req, res) => {
    const videos = readJSON(VIDEOS_FILE);
    const video = videos.find(v => v.id === req.params.id);
    if (video) { video.views = (video.views || 0) + 1; writeJSON(VIDEOS_FILE, videos); }
    
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (user) { user.videosWatched = (user.videosWatched || 0) + 1; writeJSON(USERS_FILE, users); }
    
    res.json({ success: true });
});

// ===== صفحات =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ===== تشغيل السيرفر =====
app.listen(PORT, () => {
    console.log(`🌿 HealPath Server يعمل على البورت ${PORT}`);
    console.log(`📁 المسار: http://localhost:${PORT}`);
});
