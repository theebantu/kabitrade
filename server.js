// ========== IMPORTS ==========
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const http = require('http');
const socketIo = require('socket.io');
const store = require('./store');
const mediaStore = require('./media');

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Data files
const usersFile = path.join(dataFolder, 'users.json');
const productsFile = path.join(dataFolder, 'products.json');
const socialPostsFile = path.join(dataFolder, 'socialPosts.json');
const messagesFile = path.join(dataFolder, 'messages.json');

// ========== HELPER FUNCTIONS ==========
function saveImageToDisk(file) {
  const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
  fs.writeFileSync(path.join(uploadsFolder, uniqueName), file.buffer);
  return `/uploads/${uniqueName}`;
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function resolveAuthorId(authorRef) {
  if (authorRef == null || authorRef === '') return null;
  if (typeof authorRef === 'string') return authorRef;
  if (typeof authorRef === 'object') {
    return authorRef.id || authorRef._id || null;
  }
  return null;
}

function formatPostAuthor(users, authorRef) {
  const authorId = resolveAuthorId(authorRef);
  const user = authorId ? users.find(u => u.id === authorId) : null;
  return {
    id: user?.id || authorId,
    _id: user?.id || authorId,
    username: user?.username || 'Unknown User',
    profilePicture: user?.profilePicture || 'https://via.placeholder.com/150'
  };
}

function normalizeSocialPostAuthor(post) {
  const authorId = resolveAuthorId(post.author);
  if (authorId) post.author = authorId;
  return post;
}

function normalizeProductSeller(product) {
  const sellerId = resolveAuthorId(product.seller);
  if (sellerId) product.seller = sellerId;
  return product;
}

function userIdsEqual(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function listIncludes(list, id) {
  return (list || []).some(entry => userIdsEqual(entry, id));
}

async function getUserContentCounts(userId) {
  const products = await store.get('products');
  const socialPosts = await store.get('socialPosts');
  const marketplaceListings = products.filter(p => userIdsEqual(resolveAuthorId(p.seller), userId)).length;
  const socialCount = socialPosts.filter(
    p => userIdsEqual(resolveAuthorId(p.author), userId) && new Date(p.expiresAt) > new Date()
  ).length;
  return {
    postsCount: socialCount + marketplaceListings,
    socialPosts: socialCount,
    marketplaceListings
  };
}

function formatUserProfile(user, counts) {
  const { password, ...safeUser } = user;
  return {
    ...safeUser,
    followersCount: (safeUser.followers || []).length,
    followingCount: (safeUser.following || []).length,
    postsCount: counts.postsCount,
    socialPosts: counts.socialPosts,
    marketplaceListings: counts.marketplaceListings
  };
}

function formatProductSeller(users, sellerRef) {
  return formatPostAuthor(users, sellerRef);
}

// ========== IMAGE UPLOAD ROUTE ==========
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let imageUrl = store.isMongo()
      ? await mediaStore.saveUploadedFile(req.file)
      : saveImageToDisk(req.file);

    if (!imageUrl) {
      return res.status(500).json({ error: 'Failed to save image' });
    }

    const absoluteUrl = `${req.protocol}://${req.get('host')}${imageUrl}`;
    res.json({
      message: 'Image uploaded successfully',
      imageUrl,
      absoluteUrl
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/media/:id', async (req, res) => {
  try {
    const file = await mediaStore.getMediaFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const buffer = Buffer.from(file.data, 'base64');
    res.set('Content-Type', file.mimeType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== AUTHENTICATION ROUTES ==========

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const users = await store.get('users');

    if (users.find(u => u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

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
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await store.set('users', users);

    res.status(201).json({
      message: 'User created successfully',
      token: newUser.id,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        profilePicture: newUser.profilePicture,
        following: newUser.following,
        followers: newUser.followers
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LOGIN (username or email)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const users = await store.get('users');
    const loginId = username.trim().toLowerCase();
    const user = users.find(u =>
      u.username.toLowerCase() === loginId ||
      (u.email && u.email.toLowerCase() === loginId)
    );

    if (!user) {
      return res.status(400).json({ error: 'User not found. If you signed up before, the server may have reset — please register again or contact support.' });
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
        profilePicture: user.profilePicture,
        following: user.following || [],
        followers: user.followers || []
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const users = await store.get('users');
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
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const users = await store.get('users');
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    user.password = newPassword;
    await store.set('users', users);

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== PRODUCTS ROUTES ==========

// UPLOAD PRODUCT
app.post('/api/products/upload', async (req, res) => {
  try {
    const { title, description, price, category, image } = req.body;
    const sellerId = resolveAuthorId(req.body.sellerId ?? req.body.seller);

    if (!title || !description || !price || !category || !image || !sellerId) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const users = await store.get('users');
    if (!users.find(u => u.id === sellerId)) {
      return res.status(400).json({ error: 'Seller not found. Please log in again.' });
    }

    const products = await store.get('products');

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
    await store.set('products', products);

    res.status(201).json({
      message: 'Product uploaded successfully',
      product: newProduct
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ALL PRODUCTS
app.get('/api/products/feed', async (req, res) => {
  try {
    const products = await store.get('products');
    const users = await store.get('users');

    const productsWithSeller = products
      .map(normalizeProductSeller)
      .map(product => ({
        ...product,
        seller: formatProductSeller(users, product.seller)
      }));

    res.json(productsWithSeller.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET PRODUCTS BY CATEGORY
app.get('/api/products/category/:category', async (req, res) => {
  try {
    const products = await store.get('products');
    const users = await store.get('users');

    const filtered = products
      .filter(p => p.category === req.params.category)
      .map(normalizeProductSeller)
      .map(product => ({
        ...product,
        seller: formatProductSeller(users, product.seller)
      }));

    res.json(filtered.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LIKE PRODUCT
app.post('/api/products/:productId/like', async (req, res) => {
  try {
    const { userId } = req.body;
    const products = await store.get('products');

    const product = products.find(p => p.id === req.params.productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.likes.includes(userId)) {
      product.likes = product.likes.filter(id => id !== userId);
    } else {
      product.likes.push(userId);
    }

    await store.set('products', products);

    res.json({
      likes: product.likes.length,
      liked: product.likes.includes(userId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADD COMMENT TO PRODUCT
app.post('/api/products/:productId/comment', async (req, res) => {
  try {
    const { userId, username, comment } = req.body;
    const products = await store.get('products');

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

    await store.set('products', products);

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
app.post('/api/social/create', async (req, res) => {
  try {
    const { category, content, media, mediaType } = req.body;
    const authorId = resolveAuthorId(req.body.authorId ?? req.body.author);

    if (!authorId || !category || category === 'Select Category') {
      return res.status(400).json({ error: 'Valid author and category required' });
    }

    const users = await store.get('users');
    const authorUser = users.find(u => u.id === authorId);
    if (!authorUser) {
      return res.status(400).json({ error: 'Author not found. Please log in again.' });
    }

    const posts = await store.get('socialPosts');

    const newPost = {
      id: generateId(),
      author: authorId,
      category,
      content: content || '',
      media: media || null,
      mediaType: mediaType || null,
      likes: [],
      comments: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    posts.push(newPost);
    await store.set('socialPosts', posts);

    res.status(201).json({
      message: 'Post created successfully',
      post: {
        ...newPost,
        author: formatPostAuthor(users, authorId)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET SOCIAL FEED
app.get('/api/social/feed', async (req, res) => {
  try {
    let posts = await store.get('socialPosts');
    const users = await store.get('users');

    posts = posts
      .filter(p => new Date(p.expiresAt) > new Date())
      .map(normalizeSocialPostAuthor);
    await store.set('socialPosts', posts);

    const postsWithAuthor = posts.map(post => ({
      ...post,
      author: formatPostAuthor(users, post.author)
    }));

    res.json(postsWithAuthor.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET POSTS BY CATEGORY
app.get('/api/social/category/:category', async (req, res) => {
  try {
    let posts = await store.get('socialPosts');
    const users = await store.get('users');

    posts = posts.filter(p => new Date(p.expiresAt) > new Date());

    const filtered = posts
      .filter(p => p.category === req.params.category)
      .map(normalizeSocialPostAuthor)
      .map(post => ({
        ...post,
        author: formatPostAuthor(users, post.author)
      }));

    res.json(filtered.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LIKE SOCIAL POST
app.post('/api/social/:postId/like', async (req, res) => {
  try {
    const { userId } = req.body;
    const posts = await store.get('socialPosts');

    const post = posts.find(p => p.id === req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.likes.includes(userId)) {
      post.likes = post.likes.filter(id => id !== userId);
    } else {
      post.likes.push(userId);
    }

    await store.set('socialPosts', posts);

    res.json({
      likes: post.likes.length,
      liked: post.likes.includes(userId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADD COMMENT TO SOCIAL POST
app.post('/api/social/:postId/comment', async (req, res) => {
  try {
    const { userId, username, comment } = req.body;
    const posts = await store.get('socialPosts');

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

    await store.set('socialPosts', posts);

    res.status(201).json({
      message: 'Comment added',
      comments: post.comments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== MESSAGING ==========
const activeUsers = {};

async function persistAndDeliverMessage(sender, receiver, messageText, senderName) {
  const messages = await store.get('messages');
  const newMessage = {
    id: generateId(),
    sender,
    receiver,
    message: messageText,
    timestamp: new Date().toISOString(),
    read: false
  };
  if (senderName) newMessage.senderName = senderName;

  messages.push(newMessage);
  await store.set('messages', messages);

  if (activeUsers[receiver]) {
    io.to(activeUsers[receiver]).emit('receive-message', {
      id: newMessage.id,
      senderId: sender,
      senderName: senderName || null,
      message: messageText,
      timestamp: newMessage.timestamp
    });
  }

  return newMessage;
}

// ========== MESSAGE ROUTES (specific paths before :userId1/:userId2) ==========

// GET CONVERSATIONS FOR A USER
app.get('/api/messages/user/:userId', async (req, res) => {
  try {
    const messages = await store.get('messages');
    const users = await store.get('users');
    const userId = req.params.userId;
    const conversationMap = {};

    messages.forEach(msg => {
      if (msg.sender !== userId && msg.receiver !== userId) return;

      const partnerId = msg.sender === userId ? msg.receiver : msg.sender;
      const partner = users.find(u => u.id === partnerId);
      const existing = conversationMap[partnerId];
      const msgTime = new Date(msg.timestamp).getTime();

      if (!existing || msgTime >= new Date(existing.timestamp).getTime()) {
        conversationMap[partnerId] = {
          userId: partnerId,
          username: partner?.username,
          profilePicture: partner?.profilePicture,
          lastMessage: msg.message,
          timestamp: msg.timestamp
        };
      }
    });

    const conversations = Object.values(conversationMap)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ALL CONVERSATIONS FOR A USER (alternate response shape)
app.get('/api/messages/conversations/:userId', async (req, res) => {
  try {
    const messages = await store.get('messages');
    const users = await store.get('users');
    const userId = req.params.userId;

    const conversationPartners = new Set();
    messages.forEach(msg => {
      if (msg.sender === userId) {
        conversationPartners.add(msg.receiver);
      } else if (msg.receiver === userId) {
        conversationPartners.add(msg.sender);
      }
    });

    const conversations = Array.from(conversationPartners).map(partnerId => {
      const user = users.find(u => u.id === partnerId);
      const thread = messages.filter(m =>
        (m.sender === userId && m.receiver === partnerId) ||
        (m.sender === partnerId && m.receiver === userId)
      ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const lastMessage = thread[thread.length - 1];

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
app.post('/api/messages/send', async (req, res) => {
  try {
    const { sender, receiver, message, senderName } = req.body;

    if (!sender || !receiver || !message) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const users = await store.get('users');
    if (!users.find(u => u.id === sender) || !users.find(u => u.id === receiver)) {
      return res.status(400).json({ error: 'Invalid sender or receiver' });
    }

    const newMessage = await persistAndDeliverMessage(sender, receiver, message, senderName);
    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MARK MESSAGE AS READ
app.put('/api/messages/:messageId/read', async (req, res) => {
  try {
    const messages = await store.get('messages');
    const message = messages.find(m => m.id === req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    message.read = true;
    await store.set('messages', messages);

    res.json({ message: 'Message marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ALL MESSAGES BETWEEN TWO USERS (must be after /user/ and /conversations/)
app.get('/api/messages/:userId1/:userId2', async (req, res) => {
  try {
    const messages = await store.get('messages');
    const userId1 = req.params.userId1;
    const userId2 = req.params.userId2;

    const conversation = messages.filter(m =>
      (m.sender === userId1 && m.receiver === userId2) ||
      (m.sender === userId2 && m.receiver === userId1)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== USER ROUTES ==========

// SEARCH USERS (must be before /api/users/:userId)
app.get('/api/users/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query) {
      return res.json([]);
    }

    const users = await store.get('users');
    const results = users
      .filter(u =>
        u.username.toLowerCase().includes(query) ||
        (u.email && u.email.toLowerCase().includes(query)) ||
        (u.bio && u.bio.toLowerCase().includes(query))
      )
      .map(u => {
        const { password, ...safe } = u;
        return {
          id: safe.id,
          username: safe.username,
          email: safe.email,
          bio: safe.bio,
          profilePicture: safe.profilePicture,
          location: safe.location
        };
      });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SEARCH SOCIAL (users + posts)
app.get('/api/social/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query) {
      return res.json({ users: [], posts: [] });
    }

    const users = await store.get('users');
    let posts = await store.get('socialPosts');

    const matchedUsers = users
      .filter(u =>
        u.username.toLowerCase().includes(query) ||
        (u.email && u.email.toLowerCase().includes(query))
      )
      .map(u => formatPostAuthor(users, u.id));

    posts = posts
      .filter(p => new Date(p.expiresAt) > new Date())
      .map(normalizeSocialPostAuthor)
      .filter(post => {
        const author = formatPostAuthor(users, post.author);
        return (
          (post.content && post.content.toLowerCase().includes(query)) ||
          (post.category && post.category.toLowerCase().includes(query)) ||
          author.username.toLowerCase().includes(query)
        );
      })
      .map(post => ({
        ...post,
        author: formatPostAuthor(users, post.author)
      }));

    res.json({ users: matchedUsers, posts: posts.reverse() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET USER PROFILE
app.get('/api/users/:userId', async (req, res) => {
  try {
    const users = await store.get('users');
    const user = users.find(u => userIdsEqual(u.id, req.params.userId));

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const counts = await getUserContentCounts(user.id);
    res.json(formatUserProfile(user, counts));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FOLLOW USER
app.post('/api/users/:userId/follow', async (req, res) => {
  try {
    const { currentUserId } = req.body;
    const targetUserId = req.params.userId;

    if (!currentUserId) {
      return res.status(400).json({ error: 'You must be logged in to follow' });
    }

    if (userIdsEqual(currentUserId, targetUserId)) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }

    const users = await store.get('users');
    const userToFollow = users.find(u => userIdsEqual(u.id, targetUserId));
    const currentUser = users.find(u => userIdsEqual(u.id, currentUserId));

    if (!userToFollow || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    currentUser.following = currentUser.following || [];
    userToFollow.followers = userToFollow.followers || [];

    if (!listIncludes(currentUser.following, targetUserId)) {
      currentUser.following.push(targetUserId);
    }

    if (!listIncludes(userToFollow.followers, currentUserId)) {
      userToFollow.followers.push(currentUserId);
    }

    await store.set('users', users);

    const targetCounts = await getUserContentCounts(userToFollow.id);
    const currentCounts = await getUserContentCounts(currentUser.id);

    res.json({
      message: 'Followed successfully',
      currentUser: formatUserProfile(currentUser, currentCounts),
      targetUser: formatUserProfile(userToFollow, targetCounts)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UNFOLLOW USER
app.post('/api/users/:userId/unfollow', async (req, res) => {
  try {
    const { currentUserId } = req.body;
    const targetUserId = req.params.userId;

    if (!currentUserId) {
      return res.status(400).json({ error: 'You must be logged in' });
    }

    const users = await store.get('users');
    const userToUnfollow = users.find(u => userIdsEqual(u.id, targetUserId));
    const currentUser = users.find(u => userIdsEqual(u.id, currentUserId));

    if (!userToUnfollow || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    currentUser.following = (currentUser.following || []).filter(id => !userIdsEqual(id, targetUserId));
    userToUnfollow.followers = (userToUnfollow.followers || []).filter(id => !userIdsEqual(id, currentUserId));

    await store.set('users', users);

    const targetCounts = await getUserContentCounts(userToUnfollow.id);
    const currentCounts = await getUserContentCounts(currentUser.id);

    res.json({
      message: 'Unfollowed successfully',
      currentUser: formatUserProfile(currentUser, currentCounts),
      targetUser: formatUserProfile(userToUnfollow, targetCounts)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE USER PROFILE
app.put('/api/users/:userId', async (req, res) => {
  try {
    const { bio, profilePicture, location } = req.body;
    const users = await store.get('users');

    const user = users.find(u => u.id === req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (bio !== undefined) user.bio = bio;
    if (profilePicture) user.profilePicture = profilePicture;
    if (location !== undefined) user.location = location;

    await store.set('users', users);

    const { password, ...safeUser } = user;
    res.json({ message: 'Profile updated', user: safeUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user-online', (userId) => {
    activeUsers[userId] = socket.id;
    console.log('User online:', userId);
    io.emit('user-status', { userId, status: 'online' });
  });

  socket.on('send-message', async (data) => {
    try {
      const message = await persistAndDeliverMessage(
        data.senderId,
        data.receiverId,
        data.message,
        data.senderName
      );
      socket.emit('message-sent', { success: true, messageId: message.id });
    } catch (error) {
      console.error('Message error:', error);
      socket.emit('message-sent', { success: false, error: error.message });
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

async function startServer() {
  try {
    await store.init({
      users: usersFile,
      products: productsFile,
      socialPosts: socialPostsFile,
      messages: messagesFile
    });

    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      if (store.isMongo()) {
        console.log('✅ Persistent storage: MongoDB (users & posts survive restarts)');
        console.log('📸 Images stored in MongoDB');
      } else {
        console.log('⚠️  Using local JSON files — set MONGODB_URI on Render for permanent storage');
        console.log('📸 Images stored in /uploads folder');
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();