import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import crypto from 'crypto';

const SUPER_ADMIN_USERNAME = 'admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    profile_name TEXT,
    bio TEXT,
    avatar TEXT,
    is_profile_complete BOOLEAN DEFAULT 0,
    role TEXT DEFAULT 'user',
    is_suspended BOOLEAN DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    UNIQUE(sender_id, receiver_id)
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chatrooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chatroom_members (
    chatroom_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chatroom_id, user_id),
    FOREIGN KEY (chatroom_id) REFERENCES chatrooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chatroom_messages (
    id TEXT PRIMARY KEY,
    chatroom_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chatroom_id) REFERENCES chatrooms(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );
`);

// Add new columns if they don't exist (for existing databases)
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN is_suspended BOOLEAN DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE chatroom_messages ADD COLUMN image_url TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE chatrooms ADD COLUMN music_url TEXT"); } catch (e) {}

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

class AppServer {
  private static instance: AppServer;
  public app: express.Application;
  public httpServer: any;
  public io: Server;
  private userSockets: Map<string, string>;

  private constructor() {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    this.httpServer = createHttpServer(this.app);
    this.io = new Server(this.httpServer, {
      cors: { origin: '*' },
    });
    this.userSockets = new Map<string, string>();

    this.setupSockets();
    this.setupRoutes();
  }

  public static getInstance(): AppServer {
    if (!AppServer.instance) {
      AppServer.instance = new AppServer();
    }
    return AppServer.instance;
  }

  private setupSockets() {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }
      jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
        if (err) return next(new Error('Authentication error'));
        
        const user = db.prepare('SELECT is_suspended FROM users WHERE id = ?').get(decoded.id) as any;
        if (!user || user.is_suspended) {
          return next(new Error('Account suspended'));
        }
        
        socket.data.user = decoded;
        next();
      });
    });

    this.io.on('connection', (socket) => {
      const currentUserId = socket.data.user.id;
      this.userSockets.set(currentUserId, socket.id);
      
      const connections = db.prepare(`
        SELECT sender_id, receiver_id FROM connections 
        WHERE status = 'accepted' AND (sender_id = ? OR receiver_id = ?)
      `).all(currentUserId, currentUserId) as any[];
      
      connections.forEach(conn => {
        const friendId = conn.sender_id === currentUserId ? conn.receiver_id : conn.sender_id;
        const friendSocketId = this.userSockets.get(friendId);
        if (friendSocketId) {
          this.io.to(friendSocketId).emit('user_status', { userId: currentUserId, status: 'online' });
        }
      });

      socket.on('send_message', (data: { receiverId: string; text: string }) => {
        const receiverSocketId = this.userSockets.get(data.receiverId);
        const message = {
          id: crypto.randomUUID(),
          senderId: currentUserId,
          receiverId: data.receiverId,
          text: data.text,
          timestamp: new Date().toISOString(),
        };
        
        if (receiverSocketId) {
          this.io.to(receiverSocketId).emit('receive_message', message);
        }
        socket.emit('receive_message', message);
      });

      socket.on('call_user', (data: { userToCall: string; signalData: any; type: 'video' | 'voice' }) => {
        const receiverSocketId = this.userSockets.get(data.userToCall);
        if (receiverSocketId) {
          this.io.to(receiverSocketId).emit('call_user', { signal: data.signalData, from: currentUserId, type: data.type });
        }
      });

      socket.on('answer_call', (data: { to: string; signal: any }) => {
        const callerSocketId = this.userSockets.get(data.to);
        if (callerSocketId) {
          this.io.to(callerSocketId).emit('call_accepted', data.signal);
        }
      });

      socket.on('end_call', (data: { to: string }) => {
        const receiverSocketId = this.userSockets.get(data.to);
        if (receiverSocketId) {
          this.io.to(receiverSocketId).emit('call_ended');
        }
      });

      // Chatroom events
      socket.on('join_room', (roomId: string) => {
        socket.join(roomId);
      });

      socket.on('leave_room', (roomId: string) => {
        socket.leave(roomId);
      });

      socket.on('send_room_message', (data: { roomId: string; text: string; image_url?: string }) => {
        const message = {
          id: crypto.randomUUID(),
          chatroom_id: data.roomId,
          sender_id: currentUserId,
          content: data.text,
          image_url: data.image_url || null,
          created_at: new Date().toISOString(),
        };
        
        try {
          db.prepare('INSERT INTO chatroom_messages (id, chatroom_id, sender_id, content, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(message.id, message.chatroom_id, message.sender_id, message.content, message.image_url, message.created_at);
          
          const sender = db.prepare('SELECT username, profile_name, avatar FROM users WHERE id = ?').get(currentUserId) as any;
          
          this.io.to(data.roomId).emit('receive_room_message', {
            ...message,
            username: sender.username,
            profile_name: sender.profile_name,
            avatar: sender.avatar
          });
        } catch (err) {
          console.error('Error saving room message:', err);
        }
      });

      socket.on('disconnect', () => {
        this.userSockets.delete(currentUserId);
        const connections = db.prepare(`
          SELECT sender_id, receiver_id FROM connections 
          WHERE status = 'accepted' AND (sender_id = ? OR receiver_id = ?)
        `).all(currentUserId, currentUserId) as any[];
        
        connections.forEach(conn => {
          const friendId = conn.sender_id === currentUserId ? conn.receiver_id : conn.sender_id;
          const friendSocketId = this.userSockets.get(friendId);
          if (friendSocketId) {
            this.io.to(friendSocketId).emit('user_status', { userId: currentUserId, status: 'offline' });
          }
        });
      });
    });
  }

  private authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return res.sendStatus(403);
      
      // Check if user is suspended
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id) as any;
      if (!user) return res.sendStatus(404);
      if (user.is_suspended) return res.status(403).json({ error: 'Account suspended' });
      
      req.user = user;
      next();
    });
  };

  private requireAdmin = (req: any, res: any, next: any) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  private setupRoutes() {
    this.app.post('/api/auth/register', (req, res) => {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

      try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const id = crypto.randomUUID();
        // First user is admin, or username 'admin' is admin
        const isFirstUser = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count === 0;
        const role = (isFirstUser || username === 'admin') ? 'admin' : 'user';
        
        db.prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)').run(id, username, hashedPassword, role);
        const token = jwt.sign({ id, username }, JWT_SECRET);
        res.json({ token, user: { id, username, is_profile_complete: 0, role, is_suspended: 0 } });
      } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(400).json({ error: 'Username already exists' });
        } else {
          res.status(500).json({ error: 'Server error' });
        }
      }
    });

    this.app.post('/api/auth/login', (req, res) => {
      const { username, password } = req.body;
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (user.is_suspended) {
        return res.status(403).json({ error: 'Account suspended' });
      }
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
      res.json({ token, user: { id: user.id, username: user.username, profile_name: user.profile_name, bio: user.bio, avatar: user.avatar, is_profile_complete: user.is_profile_complete, role: user.role, is_suspended: user.is_suspended } });
    });

    this.app.get('/api/auth/me', this.authenticateToken, (req: any, res) => {
      const user = db.prepare('SELECT id, username, profile_name, bio, avatar, is_profile_complete, role, is_suspended FROM users WHERE id = ?').get(req.user.id);
      res.json({ user });
    });

    this.app.post('/api/profile', this.authenticateToken, (req: any, res) => {
      const { profile_name, bio, avatar } = req.body;
      db.prepare(`
        UPDATE users SET profile_name = ?, bio = ?, avatar = ?, is_profile_complete = 1 WHERE id = ?
      `).run(profile_name, bio, avatar, req.user.id);
      res.json({ success: true });
    });

    this.app.get('/api/users', this.authenticateToken, (req: any, res) => {
      const users = db.prepare(`
        SELECT u.id, u.username, u.profile_name, u.bio, u.avatar, u.role, u.is_suspended,
               c.status as connection_status, c.sender_id
        FROM users u
        LEFT JOIN connections c ON 
          (c.sender_id = u.id AND c.receiver_id = ?) OR 
          (c.receiver_id = u.id AND c.sender_id = ?)
        WHERE u.id != ? AND u.is_profile_complete = 1
      `).all(req.user.id, req.user.id, req.user.id);
      
      const usersWithStatus = users.map((u: any) => ({
        ...u,
        isOnline: this.userSockets.has(u.id)
      }));
      
      res.json(usersWithStatus);
    });

    this.app.post('/api/connections/request', this.authenticateToken, (req: any, res) => {
      const { receiverId } = req.body;
      try {
        db.prepare('INSERT INTO connections (id, sender_id, receiver_id, status) VALUES (?, ?, ?, ?)')
          .run(crypto.randomUUID(), req.user.id, receiverId, 'pending');
        res.json({ success: true });
      } catch (err) {
        res.status(400).json({ error: 'Request already exists' });
      }
    });

    this.app.post('/api/connections/accept', this.authenticateToken, (req: any, res) => {
      const { senderId } = req.body;
      db.prepare('UPDATE connections SET status = ? WHERE sender_id = ? AND receiver_id = ?')
        .run('accepted', senderId, req.user.id);
      res.json({ success: true });
    });

    this.app.post('/api/connections/reject', this.authenticateToken, (req: any, res) => {
      const { senderId } = req.body;
      db.prepare('UPDATE connections SET status = ? WHERE sender_id = ? AND receiver_id = ?')
        .run('rejected', senderId, req.user.id);
      res.json({ success: true });
    });

    // Admin Routes
    this.app.get('/api/admin/users', this.authenticateToken, this.requireAdmin, (req: any, res) => {
      const users = db.prepare('SELECT id, username, profile_name, role, is_suspended, is_profile_complete FROM users').all();
      res.json(users);
    });

    this.app.post('/api/admin/users/:id/suspend', this.authenticateToken, this.requireAdmin, (req: any, res) => {
      const userToSuspend = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id) as any;
      if (userToSuspend && userToSuspend.username === SUPER_ADMIN_USERNAME) {
        return res.status(403).json({ error: 'Safety Feature: Cannot suspend the super admin.' });
      }

      db.prepare('UPDATE users SET is_suspended = 1 WHERE id = ?').run(req.params.id);
      
      // Disconnect user if online
      const socketId = this.userSockets.get(req.params.id);
      if (socketId) {
        this.io.to(socketId).emit('force_logout');
        this.io.sockets.sockets.get(socketId)?.disconnect(true);
      }
      
      res.json({ success: true });
    });

    this.app.post('/api/admin/users/:id/activate', this.authenticateToken, this.requireAdmin, (req: any, res) => {
      db.prepare('UPDATE users SET is_suspended = 0 WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    });

    this.app.delete('/api/admin/users/:id', this.authenticateToken, this.requireAdmin, (req: any, res) => {
      const userId = req.params.id;
      const userToDelete = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
      if (userToDelete && userToDelete.username === SUPER_ADMIN_USERNAME) {
        return res.status(403).json({ error: 'Safety Feature: Cannot delete the super admin.' });
      }
      
      db.transaction(() => {
        db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(userId, userId);
        db.prepare('DELETE FROM connections WHERE sender_id = ? OR receiver_id = ?').run(userId, userId);
        db.prepare('DELETE FROM chatroom_messages WHERE sender_id = ?').run(userId);
        db.prepare('DELETE FROM chatroom_members WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM support_tickets WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      })();
      res.json({ success: true });
    });

    this.app.delete('/api/admin/chatrooms/:id', this.authenticateToken, this.requireAdmin, (req: any, res) => {
      const roomId = req.params.id;
      db.transaction(() => {
        db.prepare('DELETE FROM chatroom_messages WHERE chatroom_id = ?').run(roomId);
        db.prepare('DELETE FROM chatroom_members WHERE chatroom_id = ?').run(roomId);
        db.prepare('DELETE FROM chatrooms WHERE id = ?').run(roomId);
      })();
      res.json({ success: true });
    });

    // Support Tickets Routes
    this.app.post('/api/tickets', this.authenticateToken, (req: any, res) => {
      const { subject, message } = req.body;
      if (!subject || !message) return res.status(400).json({ error: 'Missing fields' });
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO support_tickets (id, user_id, subject, message) VALUES (?, ?, ?, ?)')
        .run(id, req.user.id, subject, message);
      res.json({ success: true, ticketId: id });
    });

    this.app.get('/api/tickets', this.authenticateToken, (req: any, res) => {
      if (req.user.role === 'admin') {
        const tickets = db.prepare(`
          SELECT t.*, u.username, u.profile_name 
          FROM support_tickets t 
          JOIN users u ON t.user_id = u.id 
          ORDER BY t.created_at DESC
        `).all();
        res.json(tickets);
      } else {
        const tickets = db.prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
        res.json(tickets);
      }
    });

    this.app.post('/api/admin/tickets/:id/resolve', this.authenticateToken, this.requireAdmin, (req: any, res) => {
      db.prepare("UPDATE support_tickets SET status = 'resolved' WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    });

    // Chatrooms Routes
    this.app.post('/api/chatrooms', this.authenticateToken, (req: any, res) => {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Missing room name' });
      
      const roomId = crypto.randomUUID();
      // Generate a simple 6-character code
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      
      try {
        db.transaction(() => {
          db.prepare('INSERT INTO chatrooms (id, name, code, created_by) VALUES (?, ?, ?, ?)')
            .run(roomId, name, code, req.user.id);
          db.prepare('INSERT INTO chatroom_members (chatroom_id, user_id) VALUES (?, ?)')
            .run(roomId, req.user.id);
        })();
        res.json({ success: true, room: { id: roomId, name, code, created_by: req.user.id } });
      } catch (err) {
        res.status(500).json({ error: 'Failed to create room' });
      }
    });

    this.app.post('/api/chatrooms/join', this.authenticateToken, (req: any, res) => {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Missing room code' });
      
      const room = db.prepare('SELECT * FROM chatrooms WHERE code = ?').get(code.toUpperCase()) as any;
      if (!room) return res.status(404).json({ error: 'Room not found' });
      
      try {
        db.prepare('INSERT INTO chatroom_members (chatroom_id, user_id) VALUES (?, ?)')
          .run(room.id, req.user.id);
        res.json({ success: true, room });
      } catch (err: any) {
        if (err.message.includes('UNIQUE constraint failed')) {
          res.json({ success: true, room, message: 'Already a member' });
        } else {
          res.status(500).json({ error: 'Failed to join room' });
        }
      }
    });

    this.app.get('/api/chatrooms', this.authenticateToken, (req: any, res) => {
      if (req.user.role === 'admin') {
        const rooms = db.prepare('SELECT * FROM chatrooms ORDER BY created_at DESC').all();
        res.json(rooms);
      } else {
        const rooms = db.prepare(`
          SELECT c.* 
          FROM chatrooms c
          JOIN chatroom_members cm ON c.id = cm.chatroom_id
          WHERE cm.user_id = ?
          ORDER BY c.created_at DESC
        `).all(req.user.id);
        res.json(rooms);
      }
    });

    this.app.get('/api/chatrooms/:id/messages', this.authenticateToken, (req: any, res) => {
      const roomId = req.params.id;
      // Check if user is a member
      const member = db.prepare('SELECT * FROM chatroom_members WHERE chatroom_id = ? AND user_id = ?')
        .get(roomId, req.user.id);
      
      if (!member && req.user.role !== 'admin') return res.status(403).json({ error: 'Not a member of this room' });
      
      const messages = db.prepare(`
        SELECT m.*, u.username, u.profile_name, u.avatar 
        FROM chatroom_messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.chatroom_id = ?
        ORDER BY m.created_at ASC
      `).all(roomId);
      
      res.json(messages);
    });

    this.app.get('/api/chatrooms/:id/members', this.authenticateToken, (req: any, res) => {
      const roomId = req.params.id;
      const members = db.prepare(`
        SELECT u.id, u.username, u.profile_name, u.avatar
        FROM chatroom_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.chatroom_id = ?
      `).all(roomId);
      res.json(members);
    });

    this.app.put('/api/chatrooms/:id/settings', this.authenticateToken, (req: any, res) => {
      const { name, music_url } = req.body;
      const roomId = req.params.id;
      
      const room = db.prepare('SELECT * FROM chatrooms WHERE id = ?').get(roomId) as any;
      if (!room || room.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized to modify this room' });
      }
      
      db.prepare('UPDATE chatrooms SET name = ?, music_url = ? WHERE id = ?').run(name, music_url, roomId);
      
      this.io.to(roomId).emit('room_updated', { id: roomId, name, music_url });
      res.json({ success: true });
    });
  }

  public async start() {
    const PORT = 3000;
    
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      this.app.use(vite.middlewares);
    } else {
      const distPath = path.join(__dirname, 'dist');
      this.app.use(express.static(distPath));
      this.app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    this.httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

// Start the singleton server
const server = AppServer.getInstance();
server.start();
