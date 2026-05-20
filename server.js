// ========== IMPORTS ==========
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const http = require('http');
const socketIo = require('socket.io');

// ========== SETUP ==========
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== FILE STORAGE SETUP ==========
const dataFolder = path.join(__dirname, 'data');
const uploadsFolder = path.join(__dirname, 'uploads');

// Create folders if they don't exist
if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder);
if (!fs.existsSync(uploadsFolder)) fs.mkdirSync(uploadsFolder);

// Serve uploaded images
app.use('/uploads', express.static(uploadsFolder));

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsFolder);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Data files
const usersFile = path.join(dataFolder, 'users.json');
const productsFile = path.join(dataFolder, 'products.json');
const socialPostsFile = path.join(dataFolder, 'socialPosts.json');
const messagesFile = path.join(dataFolder, 'messages.json');

// Initialize data files if they don't exist
function initializeDataFiles() {
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify([]));
  if (!fs.existsSync(productsFile)) fs.writeFileSync(productsFile, JSON.stringify([]));
  if (!fs.existsSync(socialPostsFile)) fs.writeFileSync(socialPostsFile, JSON.stringify([]));
  if (!fs.existsSync(messagesFile)) fs.writeFileSync(messagesFile, JSON.stringify([]));
}

initializeDataFiles();

// ========== HELPER FUNCTIONS ==========
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// ========== IMAGE UPLOAD ROUTE ==========
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    res.json({
      message: 'Image uploaded successfully',
      imageUrl: imageUrl,
      filename: req.file.filename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== AUTHENTICATION ROUTES ==========

// REGISTER
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const users = readJsonFile(usersFile);

    // Check if user exists
    if (users.find(u => u.username === username || u.email === email)) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Create new user
    const newUser = {
      id: generateId(),
      username,
      email,
      password,
      profilePicture: 'https://via.placeholder.com/150',
      bio: '',
      followers: [],
      following: [],
      location: 'Kenya',
      createdAt: new Date()
    };

    users.push(newUser);
    writeJsonFile(usersFile, users);

    res.status(201).json({
      message: 'User created successfully',
      token: newUser.id,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        profilePicture: newUser.profilePicture
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LOGIN
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const users = readJsonFile(usersFile);
    const user = users.find(u => u.username === username);

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    if (user.password !== password) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    res.json({
      message: 'Login successful',
      token: user.id,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', (req, res) => {
  try {
    const { email } = req.body;

    const users = readJsonFile(usersFile);
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(400).json({ error: 'Email not found' });
    }

    const resetToken = 'reset_' + generateId();

    res.json({
      message: 'Recovery email sent',
      resetToken,
      email: user.email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RESET PASSWORD
app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const users = readJsonFile(usersFile);
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    user.password = newPassword;
    writeJsonFile(usersFile, users);

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== PRODUCTS ROUTES ==========

// UPLOAD PRODUCT
app.post('/api/products/upload', (req, res) => {
  try {
    const { title, description, price, category, image, sellerId } = req.body;

    if (!title || !description || !price || !category || !image || !sellerId) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const products = readJsonFile(productsFile);

    const newProduct = {
      id: generateId(),
      title,
      description,
      price,
      category,
      image,
      seller: sellerId,
      likes: [],
      comments: [],
      createdAt: new Date()
    };

    products.push(newProduct);
    writeJsonFile(productsFile, products);

    res.status(201).json({
      message: 'Product uploaded successfully',
      product: newProduct
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ALL PRODUCTS
app.get('/api/products/feed', (req, res) => {
  try {
    const products = readJsonFile(productsFile);
    const users = readJsonFile(usersFile);

    const productsWithSeller = products.map(product => {
      const seller = users.find(u => u.id === product.seller);
      return {
        ...product,
        seller: {
          _id: seller?.id,
          username: seller?.username,
          profilePicture: seller?.profilePicture
        }
      };
    });

    res.json(productsWithSeller.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET PRODUCTS BY CATEGORY
app.get('/api/products/category/:category', (req, res) => {
  try {
    const products = readJsonFile(productsFile);
    const users = readJsonFile(usersFile);

    const filtered = products
      .filter(p => p.category === req.params.category)
      .map(product => {
        const seller = users.find(u => u.id === product.seller);
        return {
          ...product,
          seller: {
            _id: seller?.id,
            username: seller?.username,
            profilePicture: seller?.profilePicture
          }
        };
      });

    res.json(filtered.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LIKE PRODUCT
app.post('/api/products/:productId/like', (req, res) => {
  try {
    const { userId } = req.body;
    const products = readJsonFile(productsFile);

    const product = products.find(p => p.id === req.params.productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.likes.includes(userId)) {
      product.likes = product.likes.filter(id => id !== userId);
    } else {
      product.likes.push(userId);
    }

    writeJsonFile(productsFile, products);

    res.json({
      likes: product.likes.length,
      liked: product.likes.includes(userId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADD COMMENT TO PRODUCT
app.post('/api/products/:productId/comment', (req, res) => {
  try {
    const { userId, username, comment } = req.body;
    const products = readJsonFile(productsFile);

    const product = products.find(p => p.id === req.params.productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    product.comments.push({
      userId,
      username,
      comment,
      timestamp: new Date()
    });

    writeJsonFile(productsFile, products);

    res.status(201).json({
      message: 'Comment added',
      comments: product.comments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== SOCIAL ROUTES ==========

// CREATE SOCIAL POST
app.post('/api/social/create', (req, res) => {
  try {
    const { authorId, category, content, media, mediaType } = req.body;

    if (!authorId || !category) {
      return res.status(400).json({ error: 'Author and category required' });
    }

    const posts = readJsonFile(socialPostsFile);

    const newPost = {
      id: generateId(),
      author: authorId,
      category,
      content,
      media,
      mediaType,
      likes: [],
      comments: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };

    posts.push(newPost);
    writeJsonFile(socialPostsFile, posts);

    res.status(201).json({
      message: 'Post created successfully',
      post: newPost
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET SOCIAL FEED
app.get('/api/social/feed', (req, res) => {
  try {
    let posts = readJsonFile(socialPostsFile);
    const users = readJsonFile(usersFile);

    posts = posts.filter(p => new Date(p.expiresAt) > new Date());
    writeJsonFile(socialPostsFile, posts);

    const postsWithAuthor = posts.map(post => {
      const author = users.find(u => u.id === post.author);
      return {
        ...post,
        author: {
          _id: author?.id,
          username: author?.username,
          profilePicture: author?.profilePicture
        }
      };
    });

    res.json(postsWithAuthor.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET POSTS BY CATEGORY
app.get('/api/social/category/:category', (req, res) => {
  try {
    let posts = readJsonFile(socialPostsFile);
    const users = readJsonFile(usersFile);

    posts = posts.filter(p => new Date(p.expiresAt) > new Date());

    const filtered = posts
      .filter(p => p.category === req.params.category)
      .map(post => {
        const author = users.find(u => u.id === post.author);
        return {
          ...post,
          author: {
            _id: author?.id,
            username: author?.username,
            profilePicture: author?.profilePicture
          }
        };
      });

    res.json(filtered.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LIKE SOCIAL POST
app.post('/api/social/:postId/like', (req, res) => {
  try {
    const { userId } = req.body;
    const posts = readJsonFile(socialPostsFile);

    const post = posts.find(p => p.id === req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.likes.includes(userId)) {
      post.likes = post.likes.filter(id => id !== userId);
    } else {
      post.likes.push(userId);
    }

    writeJsonFile(socialPostsFile, posts);

    res.json({
      likes: post.likes.length,
      liked: post.likes.includes(userId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADD COMMENT TO SOCIAL POST
app.post('/api/social/:postId/comment', (req, res) => {
  try {
    const { userId, username, comment } = req.body;
    const posts = readJsonFile(socialPostsFile);

    const post = posts.find(p => p.id === req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    post.comments.push({
      userId,
      username,
      comment,
      timestamp: new Date()
    });

    writeJsonFile(socialPostsFile, posts);

    res.status(201).json({
      message: 'Comment added',
      comments: post.comments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== USER ROUTES ==========
// ========== MESSAGE ROUTES ==========

// GET ALL MESSAGES BETWEEN TWO USERS
app.get('/api/messages/:userId1/:userId2', (req, res) => {
  try {
    const messages = readJsonFile(messagesFile);
    const userId1 = req.params.userId1;
    const userId2 = req.params.userId2;

    // Get messages between these two users (in both directions)
    const conversation = messages.filter(m => 
      (m.sender === userId1 && m.receiver === userId2) ||
      (m.sender === userId2 && m.receiver === userId1)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ALL CONVERSATIONS FOR A USER
app.get('/api/messages/conversations/:userId', (req, res) => {
  try {
    const messages = readJsonFile(messagesFile);
    const users = readJsonFile(usersFile);
    const userId = req.params.userId;

    // Get unique conversation partners
    const conversationPartners = new Set();
    messages.forEach(msg => {
      if (msg.sender === userId) {
        conversationPartners.add(msg.receiver);
      } else if (msg.receiver === userId) {
        conversationPartners.add(msg.sender);
      }
    });

    // Get user details for each partner
    const conversations = Array.from(conversationPartners).map(partnerId => {
      const user = users.find(u => u.id === partnerId);
      const lastMessage = messages
        .filter(m => 
          (m.sender === userId && m.receiver === partnerId) ||
          (m.sender === partnerId && m.receiver === userId)
        )
        .pop();

      return {
        user: {
          id: user?.id,
          username: user?.username,
          profilePicture: user?.profilePicture
        },
        lastMessage: lastMessage?.message,
        timestamp: lastMessage?.timestamp,
        unread: lastMessage?.receiver === userId && !lastMessage?.read
      };
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SEND MESSAGE
app.post('/api/messages/send', (req, res) => {
  try {
    const { sender, receiver, message } = req.body;

    if (!sender || !receiver || !message) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const messages = readJsonFile(messagesFile);

    const newMessage = {
      id: generateId(),
      sender,
      receiver,
      message,
      timestamp: new Date(),
      read: false
    };

    messages.push(newMessage);
    writeJsonFile(messagesFile, messages);

    res.status(201).json({
      message: 'Message sent successfully',
      data: newMessage
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MARK MESSAGE AS READ
app.put('/api/messages/:messageId/read', (req, res) => {
  try {
    const messages = readJsonFile(messagesFile);
    const message = messages.find(m => m.id === req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    message.read = true;
    writeJsonFile(messagesFile, messages);

    res.json({ message: 'Message marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET USER PROFILE
app.get('/api/users/:userId', (req, res) => {
  try {
    const users = readJsonFile(usersFile);
    const user = users.find(u => u.id === req.params.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SEARCH USERS
app.get('/api/users/search/:query', (req, res) => {
  try {
    const users = readJsonFile(usersFile);
    const query = req.params.query.toLowerCase();

    const results = users.filter(u =>
      u.username.toLowerCase().includes(query)
    );

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FOLLOW USER
app.post('/api/users/:userId/follow', (req, res) => {
  try {
    const { currentUserId } = req.body;
    const users = readJsonFile(usersFile);

    const userToFollow = users.find(u => u.id === req.params.userId);
    const currentUser = users.find(u => u.id === currentUserId);

    if (!userToFollow || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!currentUser.following.includes(req.params.userId)) {
      currentUser.following.push(req.params.userId);
    }

    if (!userToFollow.followers.includes(currentUserId)) {
      userToFollow.followers.push(currentUserId);
    }

    writeJsonFile(usersFile, users);

    res.json({ message: 'Followed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UNFOLLOW USER
app.post('/api/users/:userId/unfollow', (req, res) => {
  try {
    const { currentUserId } = req.body;
    const users = readJsonFile(usersFile);

    const userToUnfollow = users.find(u => u.id === req.params.userId);
    const currentUser = users.find(u => u.id === currentUserId);

    if (!userToUnfollow || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    currentUser.following = currentUser.following.filter(id => id !== req.params.userId);
    userToUnfollow.followers = userToUnfollow.followers.filter(id => id !== currentUserId);

    writeJsonFile(usersFile, users);

    res.json({ message: 'Unfollowed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE USER PROFILE
app.put('/api/users/:userId', (req, res) => {
  try {
    const { bio, profilePicture, location } = req.body;
    const users = readJsonFile(usersFile);

    const user = users.find(u => u.id === req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (bio) user.bio = bio;
    if (profilePicture) user.profilePicture = profilePicture;
    if (location) user.location = location;

    writeJsonFile(usersFile, users);

    res.json({ message: 'Profile updated', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== MESSAGING WITH SOCKET.IO ==========
const activeUsers = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user-online', (userId) => {
    activeUsers[userId] = socket.id;
    console.log('User online:', userId);
    // Broadcast user is online
    io.emit('user-status', { userId, status: 'online' });
  });

  socket.on('send-message', (data) => {
    try {
      const messages = readJsonFile(messagesFile);

      const message = {
        id: generateId(),
        sender: data.senderId,
        receiver: data.receiverId,
        message: data.message,
        senderName: data.senderName,
        timestamp: new Date(),
        read: false
      };

      messages.push(message);
      writeJsonFile(messagesFile, messages);

      // Send to receiver if online
      if (activeUsers[data.receiverId]) {
        io.to(activeUsers[data.receiverId]).emit('receive-message', {
          id: message.id,
          senderId: data.senderId,
          senderName: data.senderName,
          message: data.message,
          timestamp: new Date()
        });
      }

      socket.emit('message-sent', { success: true, messageId: message.id });
    } catch (error) {
      console.error('Message error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (let userId in activeUsers) {
      if (activeUsers[userId] === socket.id) {
        delete activeUsers[userId];
        io.emit('user-status', { userId, status: 'offline' });
      }
    }
  });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`✅ All data stored in /data folder (no database needed!)`);
  console.log(`📸 Images stored in /uploads folder`);
});