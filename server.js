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

const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, 'data');
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');

[DATA_DIR, PUBLIC_DIR, VIDEOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');

function initDataFiles() {
    [USERS_FILE, CHATS_FILE, TICKETS_FILE, VIDEOS_FILE].forEach(file => {
        if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
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

app.use(cors());
app.use(express.json());
app.use('/videos', express.static(VIDEOS_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEOS_DIR),
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});

const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Login required' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'Invalid token' }); }
}

// API Routes...
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'All fields required' });
    
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        videosWatched: 0,
        supportChats: 0,
        streak: 0,
        lastVisit: null
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    
    const chats = readJSON(CHATS_FILE);
    chats.push({ 
        userId: newUser.id, 
        username: newUser.username,
        messages: [{ type: 'system', text: 'Welcome! How can we help?', time: new Date().toISOString() }],
        unread: false
    });
    writeJSON(CHATS_FILE, chats);
    
    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET);
    res.json({ token, user: { id: newUser.id, username: newUser.username } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'User not found' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Wrong password' });
    
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

app.get('/api/me', authMiddleware, (req, res) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({
        id: user.id,
        username: user.username,
        daysRecovery: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000*60*60*24)),
        videosWatched: user.videosWatched || 0,
        supportChats: user.supportChats || 0
