const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'healpath-secret-key-2026';

// ===== المسارات =====
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const DATA_DIR = path.join(BASE_DIR, 'data');
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');

// إنشاء المجلدات لو ما موجودة
[DATA_DIR, PUBLIC_DIR, VIDEOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ===== ملف البيانات =====
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } 
    catch { return []; }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/videos', express.static(VIDEOS_DIR));

// ===== التحقق من تسجيل الدخول =====
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'توكن غير صالح' }); }
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
        videosWatched: 0,
        streak: 0,
        lastVisit: null
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);

    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET);
    res.json({ token, user: { id: newUser.id, username: newUser.username } });
});

// ===== API: دخول =====
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'المستخدم غير موجود' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });

    const today = new Date().toDateString();
    if (user.lastVisit !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        user.streak = (user.lastVisit === yesterday.toDateString()) ? (user.streak || 0) + 1 : 1;
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
            streak: user.streak || 0
        } 
    });
});

// ===== API: بياناتي =====
app.get('/api/me', authMiddleware, (req, res) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'غير موجود' });
    res.json({
        id: user.id,
        username: user.username,
        daysRecovery: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000*60*60*24)),
        videosWatched: user.videosWatched || 0,
        streak: user.streak || 0
    });
});

// ===== API: الفيديوهات (يقرأ من المجلد تلقائياً) =====
app.get('/api/videos', (req, res) => {
    try {
        const files = fs.readdirSync(VIDEOS_DIR);
        const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.mkv'];
        const videoFiles = files.filter(f => videoExts.includes(path.extname(f).toLowerCase()));

        if (videoFiles.length === 0) {
            return res.json([]);
        }

        const videos = videoFiles.map((file, index) => {
            const name = file.replace(path.extname(file), '');
            // نحاول نستخرج مدة الفيديو لو موجودة بالاسم (مثال: video_15min.mp4)
            const durationMatch = name.match(/_(\d+)min$/);
            const duration = durationMatch ? durationMatch[1] + ':00' : '00:00';

            return {
                id: (index + 1).toString(),
                title: name.replace(/_/g, ' ').replace(/-\d+min$/, '').replace(/\d+min$/, ''),
                desc: 'جلسة فيديو',
                duration: duration,
                src: '/videos/' + file,
                views: Math.floor(Math.random() * 5000) + 500
            };
        });

        res.json(videos);
    } catch (err) {
        console.error('Error reading videos:', err);
        res.json([]);
    }
});

// ===== API: مشاهدة فيديو =====
app.post('/api/videos/:id/watch', authMiddleware, (req, res) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (user) { user.videosWatched = (user.videosWatched || 0) + 1; writeJSON(USERS_FILE, users); }
    res.json({ success: true });
});

// ===== الصفحات =====
app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

// ===== تشغيل السيرفر =====
app.listen(PORT, () => {
    console.log('🌿 HealPath Server يعمل على البورت ' + PORT);
});
