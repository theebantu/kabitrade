const API_URL = 'https://kabitrade.onrender.com/api';
const API_ORIGIN = API_URL.replace(/\/api$/, '');
const socket = io('https://kabitrade.onrender.com',{
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5});

let currentUser = null;
let currentPage = 'marketplace';
let currentChat = null;

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  const user = localStorage.getItem('user');
  const lastPage = localStorage.getItem('lastPage');

  if (!token || !user) {
    window.location.href = 'login.html';
    return;
  }

  currentUser = JSON.parse(user);
  ensureCurrentUserId();
  currentUser.following = currentUser.following || [];
  currentUser.followers = currentUser.followers || [];
  localStorage.setItem('user', JSON.stringify(currentUser));

  await syncCurrentUser();
  updateSidebar();
  setupSocialFeedActions();
  setupMarketplaceFeedActions();

  if (lastPage) {
    switchPage(lastPage);
  } else {
    loadMarketplaceFeed();
  }

  // Setup nav listeners
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const page = e.target.dataset.page;
      switchPage(page);
    });
  });

  // Socket setup
  socket.emit('user-online', currentUser.id);

  socket.on('receive-message', (data) => {
    loadConversations();
    if (currentChat && data.senderId === currentChat.id) {
      openConversation(currentChat.id, currentChat.name);
    }
  });
});

// ========== PAGE SWITCHING ==========
function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

  const pageElement = document.getElementById(`${page}-page`);
  if (pageElement) pageElement.classList.add('active');

  const navBtn = document.querySelector(`[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');

  currentPage = page;
  localStorage.setItem('lastPage', page);

  if (page === 'marketplace') loadMarketplaceFeed();
  else if (page === 'social') loadSocialFeed();
  else if (page === 'messages') {loadConversations();}
  else if (page === 'profile') loadProfile();
}

// ========== HELPERS ==========
function ensureCurrentUserId() {
  const token = localStorage.getItem('token');
  currentUser.id = currentUser.id || currentUser._id || token;
  return Boolean(currentUser.id);
}

function getPostAuthorId(author) {
  if (!author) return null;
  if (typeof author === 'string' && author !== 'undefined' && author !== 'null') return author;
  const id = author.id || author._id || null;
  return id && id !== 'undefined' && id !== 'null' ? String(id) : null;
}

function getSellerId(product) {
  return getPostAuthorId(product?.seller);
}

function sameUserId(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
}

function resolveMediaUrl(media) {
  if (!media) return null;
  if (media.startsWith('http://') || media.startsWith('https://')) return media;
  return `${API_ORIGIN}${media.startsWith('/') ? media : '/' + media}`;
}

function setupSocialFeedActions() {
  const feed = document.getElementById('socialFeed');
  if (!feed || feed.dataset.actionsBound) return;
  feed.dataset.actionsBound = 'true';

  feed.addEventListener('click', (e) => {
    const messageBtn = e.target.closest('[data-social-message]');
    if (messageBtn) {
      e.stopPropagation();
      startConversation(messageBtn.dataset.userId, messageBtn.dataset.userName);
      return;
    }

    const profileEl = e.target.closest('[data-social-profile]');
    if (profileEl) {
      viewUserProfile(profileEl.dataset.userId, profileEl.dataset.userName);
    }
  });
}

function setupMarketplaceFeedActions() {
  const feed = document.getElementById('marketplaceFeed');
  if (!feed || feed.dataset.actionsBound) return;
  feed.dataset.actionsBound = 'true';

  feed.addEventListener('click', (e) => {
    const messageBtn = e.target.closest('[data-market-message]');
    if (messageBtn) {
      e.stopPropagation();
      startConversation(messageBtn.dataset.userId, messageBtn.dataset.userName);
      return;
    }

    const sellerEl = e.target.closest('[data-market-seller]');
    if (sellerEl) {
      viewUserProfile(sellerEl.dataset.userId, sellerEl.dataset.userName);
    }
  });
}

async function syncCurrentUser() {
  if (!ensureCurrentUserId()) return false;
  try {
    const response = await fetch(`${API_URL}/users/${currentUser.id}`);
    if (!response.ok) return false;
    const user = await response.json();
    currentUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      profilePicture: user.profilePicture,
      following: user.following || [],
      followers: user.followers || [],
      bio: user.bio,
      location: user.location
    };
    localStorage.setItem('user', JSON.stringify(currentUser));
    localStorage.setItem('token', user.id);
    updateSidebar();
    return true;
  } catch (error) {
    console.error('Could not sync user profile:', error);
    return false;
  }
}

// ========== SIDEBAR ==========
function updateSidebar() {
  document.getElementById('sidebarUsername').textContent = currentUser.username;
  document.getElementById('sidebarProfilePic').src = currentUser.profilePicture || 'https://via.placeholder.com/50';
}

// ========== MARKETPLACE ==========
async function loadMarketplaceFeed() {
  try {
    const response = await fetch(`${API_URL}/products/feed`);
    const products = await response.json();

    const feed = document.getElementById('marketplaceFeed');
    feed.innerHTML = '';

    products.forEach(product => {
      const sellerId = getSellerId(product);
      const sellerName = product.seller?.username || 'Unknown User';
      const sellerPic = product.seller?.profilePicture || 'https://via.placeholder.com/150';
      const imageUrl = resolveMediaUrl(product.image) || product.image;
      const messageBtn = sellerId && !sameUserId(sellerId, currentUser.id)
        ? `<button type="button" class="action-btn" data-market-message data-user-id="${escapeAttr(sellerId)}" data-user-name="${escapeAttr(sellerName)}">💬 Message</button>`
        : '';
      const sellerAttrs = sellerId
        ? `data-market-seller data-user-id="${escapeAttr(sellerId)}" data-user-name="${escapeAttr(sellerName)}" style="cursor: pointer;"`
        : 'style="cursor: default;"';

      const productHTML = `
        <div class="product">
          <div class="product-header">
  <div class="product-seller" ${sellerAttrs}>
    <img src="${escapeAttr(sellerPic)}" alt="" class="author-pic">
    <div class="seller-name">${escapeAttr(sellerName)}</div>
  </div>
  ${messageBtn}
</div>
          <img src="${escapeAttr(imageUrl)}" alt="" class="product-image" onerror="this.src='https://via.placeholder.com/400'">
          <div class="product-content">
            <div class="product-title">${product.title}</div>
            <div class="product-price">KES ${product.price.toLocaleString()}</div>
            <div class="product-category">${product.category}</div>
            <div class="product-description">${product.description}</div>
          </div>
          <div class="product-actions">
            <button class="action-btn ${product.likes.includes(currentUser.id) ? 'liked' : ''}" onclick="likeProduct('${product.id}')">
              ❤️ ${product.likes.length}
            </button>
            <button class="action-btn" onclick="toggleCommentSection('product-${product.id}')">
              💬 ${product.comments.length}
            </button>
          </div>
          <div id="product-${product.id}" class="comments-section" style="display:none;">
            ${product.comments.map(comment => `
              <div class="comment">
                <span class="comment-author">${comment.username}:</span>
                ${comment.comment}
              </div>
            `).join('')}
            <div class="comment-input-area">
              <input type="text" placeholder="Add comment..." id="commentInput-${product.id}">
              <button class="comment-submit" onclick="addProductComment('${product.id}')">Post</button>
            </div>
          </div>
        </div>
      `;
      feed.innerHTML += productHTML;
    });
  } catch (error) {
    console.error('Error loading marketplace:', error);
  }
}

async function likeProduct(productId) {
  try {
    const response = await fetch(`${API_URL}/products/${productId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });

    if (response.ok) loadMarketplaceFeed();
  } catch (error) {
    console.error('Error liking product:', error);
  }
}

async function addProductComment(productId) {
  try {
    const commentInput = document.getElementById(`commentInput-${productId}`);
    const comment = commentInput.value.trim();

    if (!comment) return;

    const response = await fetch(`${API_URL}/products/${productId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        username: currentUser.username,
        comment
      })
    });

    if (response.ok) {
      commentInput.value = '';
      loadMarketplaceFeed();
    }
  } catch (error) {
    console.error('Error adding comment:', error);
  }
}

function toggleCommentSection(elementId) {
  const element = document.getElementById(elementId);
  element.style.display = element.style.display === 'none' ? 'block' : 'none';
}

// ========== UPLOAD PRODUCT ==========
function showUploadModal() {
  document.getElementById('uploadModal').classList.add('show');
  setupImagePreview('productImage', 'imagePreview', 'previewImg');
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.remove('show');
}

// Setup image preview
function setupImagePreview(inputId, previewContainerId, previewImgId) {
  const fileInput = document.getElementById(inputId);
  const previewContainer = document.getElementById(previewContainerId);
  const previewImg = document.getElementById(previewImgId);

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        previewImg.src = event.target.result;
        previewContainer.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });
}

async function uploadProduct(event) {
  event.preventDefault();

  if (!ensureCurrentUserId()) {
    alert('Session expired. Please log in again.');
    window.location.href = 'login.html';
    return;
  }

  const title = document.getElementById('productTitle').value;
  const description = document.getElementById('productDesc').value;
  const price = document.getElementById('productPrice').value;
  const category = document.getElementById('productCategory').value;
  const imageFile = document.getElementById('productImage').files[0];
  const uploadStatus = document.getElementById('uploadStatus');
  const submitBtn = document.getElementById('submitBtn');

  if (!title || !description || !price || !category || !imageFile) {
    uploadStatus.textContent = '❌ Please fill all required fields';
    uploadStatus.classList.add('error');
    uploadStatus.style.display = 'block';
    return;
  }

  try {
    // Show loading status
    uploadStatus.textContent = '⏳ Uploading image...';
    uploadStatus.classList.remove('error');
    uploadStatus.style.display = 'block';
    submitBtn.disabled = true;

    // Upload image first
    const formData = new FormData();
    formData.append('image', imageFile);

    const uploadResponse = await fetch(`${API_URL}/upload`, {
      method: 'POST',
      body: formData
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image');
    }

    const uploadData = await uploadResponse.json();
    const imageUrl = uploadData.imageUrl;

    uploadStatus.textContent = '📤 Uploading product...';

    // Now upload the product with the image URL
    const productResponse = await fetch(`${API_URL}/products/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        price: Number(price),
        category,
        image: imageUrl,
        sellerId: currentUser.id
      })
    });

    if (productResponse.ok) {
      uploadStatus.textContent = '✅ Product uploaded successfully!';
      uploadStatus.classList.remove('error');
      submitBtn.disabled = false;

      setTimeout(() => {
        closeUploadModal();
        loadMarketplaceFeed();
        document.querySelector('#uploadModal form').reset();
        document.getElementById('imagePreview').style.display = 'none';
        uploadStatus.style.display = 'none';
      }, 1500);
    } else {
      throw new Error('Failed to upload product');
    }
  } catch (error) {
    console.error('Error:', error);
    uploadStatus.textContent = '❌ ' + error.message;
    uploadStatus.classList.add('error');
    submitBtn.disabled = false;
  }
}

// ========== SOCIAL ==========
async function loadSocialFeed(category = 'all') {
  try {
    let url = `${API_URL}/social/feed`;
    if (category !== 'all') {
      url = `${API_URL}/social/category/${category}`;
    }

    const response = await fetch(url);
    const posts = await response.json();

    const feed = document.getElementById('socialFeed');
    feed.innerHTML = '';

    posts.forEach(post => {
      const authorId = getPostAuthorId(post.author);
      const authorName = post.author?.username || 'Unknown User';
      const authorPic = post.author?.profilePicture || 'https://via.placeholder.com/150';
      const mediaUrl = resolveMediaUrl(post.media);
      const messageBtn = authorId && !sameUserId(authorId, currentUser.id)
        ? `<button type="button" class="action-btn" data-social-message data-user-id="${escapeAttr(authorId)}" data-user-name="${escapeAttr(authorName)}">💬 Message</button>`
        : '';
      const profileAttrs = authorId
        ? `data-social-profile data-user-id="${escapeAttr(authorId)}" data-user-name="${escapeAttr(authorName)}" style="cursor: pointer;"`
        : 'style="cursor: default;"';

      const postHTML = `
        <div class="post">
          <div class="post-header">
            <div class="post-author" ${profileAttrs}>
  <img src="${escapeAttr(authorPic)}" alt="" class="author-pic">
  <div>
    <div class="author-name">${escapeAttr(authorName)}</div>
    <small style="color: #8e8e8e;">${escapeAttr(post.category)}</small>
  </div>
</div>
  ${messageBtn}
          </div>
          ${mediaUrl ? `<img src="${escapeAttr(mediaUrl)}" alt="" class="post-image" onerror="this.src='https://via.placeholder.com/400'">` : ''}
          <div class="post-content">
            <div class="post-text">${post.content || ''}</div>
          </div>
          <div class="post-actions">
            <button class="action-btn ${post.likes.includes(currentUser.id) ? 'liked' : ''}" onclick="likeSocialPost('${post.id}')">
              ❤️ ${post.likes.length}
            </button>
            <button class="action-btn" onclick="toggleCommentSection('social-${post.id}')">
              💬 ${post.comments.length}
            </button>
          </div>
          <div id="social-${post.id}" class="comments-section" style="display:none;">
            ${post.comments.map(comment => `
              <div class="comment">
                <span class="comment-author">${comment.username}:</span>
                ${comment.comment}
              </div>
            `).join('')}
            <div class="comment-input-area">
              <input type="text" placeholder="Add comment..." id="socialCommentInput-${post.id}">
              <button class="comment-submit" onclick="addSocialComment('${post.id}')">Post</button>
            </div>
          </div>
        </div>
      `;
      feed.innerHTML += postHTML;
    });
  } catch (error) {
    console.error('Error loading social feed:', error);
  }
}

async function likeSocialPost(postId) {
  try {
    const response = await fetch(`${API_URL}/social/${postId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });

    if (response.ok) loadSocialFeed();
  } catch (error) {
    console.error('Error liking post:', error);
  }
}

async function addSocialComment(postId) {
  try {
    const commentInput = document.getElementById(`socialCommentInput-${postId}`);
    const comment = commentInput.value.trim();

    if (!comment) return;

    const response = await fetch(`${API_URL}/social/${postId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        username: currentUser.username,
        comment
      })
    });

    if (response.ok) {
      commentInput.value = '';
      loadSocialFeed();
    }
  } catch (error) {
    console.error('Error adding comment:', error);
  }
}

function filterSocial(category) {
  loadSocialFeed(category);
}

function showSocialPostModal() {
  document.getElementById('socialPostModal').classList.add('show');
  setupImagePreview('socialImage', 'socialImagePreview', 'socialPreviewImg');
}

function closeSocialPostModal() {
  document.getElementById('socialPostModal').classList.remove('show');
}

async function createSocialPost(event) {
  event.preventDefault();

  if (!ensureCurrentUserId()) {
    alert('Session expired. Please log in again.');
    window.location.href = 'login.html';
    return;
  }

  const category = document.getElementById('socialCategory').value;
  const content = document.getElementById('postContent').value;
  const imageFile = document.getElementById('socialImage').files[0];
  const uploadStatus = document.getElementById('socialUploadStatus');
  const submitBtn = document.getElementById('socialSubmitBtn');

  if (!category || category === 'Select Category') {
    uploadStatus.textContent = '❌ Please select a category';
    uploadStatus.classList.add('error');
    uploadStatus.style.display = 'block';
    return;
  }

  try {
    let imageUrl = null;

    // Upload image if provided
    if (imageFile) {
      uploadStatus.textContent = '⏳ Uploading image...';
      uploadStatus.classList.remove('error');
      uploadStatus.style.display = 'block';
      submitBtn.disabled = true;

      const formData = new FormData();
      formData.append('image', imageFile);

      const uploadResponse = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('Image upload failed');
      }

      const uploadData = await uploadResponse.json();
      imageUrl = uploadData.imageUrl || uploadData.absoluteUrl;
    }

    uploadStatus.textContent = '📤 Creating post...';

    const response = await fetch(`${API_URL}/social/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorId: currentUser.id,
        category,
        content,
        media: imageUrl,
        mediaType: imageUrl ? 'image' : null
      })
    });

    if (response.ok) {
      uploadStatus.textContent = '✅ Post created successfully!';
      uploadStatus.classList.remove('error');
      submitBtn.disabled = false;

      setTimeout(() => {
        closeSocialPostModal();
        loadSocialFeed();
        document.querySelector('#socialPostModal form').reset();
        document.getElementById('socialImagePreview').style.display = 'none';
        uploadStatus.style.display = 'none';
      }, 1500);
    } else {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create post');
    }
  } catch (error) {
    console.error('Error:', error);
    uploadStatus.textContent = '❌ ' + error.message;
    uploadStatus.classList.add('error');
    submitBtn.disabled = false;
  }
}

// ========== MESSAGING ==========

async function loadConversations() {
  try {
    const response = await fetch(`${API_URL}/messages/user/${currentUser.id}`);
    const conversations = await response.json();

    const list = document.getElementById('conversationsList');
    list.innerHTML = '';

    if (!conversations || conversations.length === 0) {
      list.innerHTML = '<p style="padding: 20px;">No conversations</p>';
      return;
    }

    conversations.forEach(conv => {
      const item = document.createElement('div');
      item.className = 'conversation-item';
      item.onclick = () => openConversation(conv.userId, conv.username);
      item.innerHTML = `
        <img src="${conv.profilePicture}" style="width: 40px; height: 40px; border-radius: 50%; margin-right: 10px;">
        <div><strong>${conv.username}</strong></div>
      `;
      list.appendChild(item);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

async function openConversation(userId, username) {
  currentChat = { id: userId, name: username };
  document.getElementById('chatHeader').innerHTML = `<h3>${username}</h3>`;
  
  const response = await fetch(`${API_URL}/messages/${currentUser.id}/${userId}`);
  const messages = await response.json();

  const area = document.getElementById('messagesArea');
  area.innerHTML = '';

  messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = 'message ' + (msg.sender === currentUser.id ? 'sent' : 'received');
    div.textContent = msg.message;
    area.appendChild(div);
  });

  area.scrollTop = area.scrollHeight;
}

function startConversation(userId, userName) {
  ensureCurrentUserId();
  const id = userId ? String(userId).trim() : '';
  if (!id || id === 'undefined' || id === 'null') {
    alert('Could not find this user. Please refresh the page and try again.');
    return;
  }
  if (sameUserId(id, currentUser.id)) {
    alert('You cannot message yourself.');
    return;
  }
  currentChat = { id, name: userName || 'User' };
  switchPage('messages');
  document.getElementById('chatHeader').innerHTML = `<h3>${escapeAttr(userName || 'User')}</h3>`;
  document.getElementById('messagesArea').innerHTML = '<p>Start chatting!</p>';
  loadConversations();
}

function sendMessageToSeller(sellerId, sellerName) {
  startConversation(sellerId, sellerName);
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const msg = input.value.trim();

  if (!msg || !currentChat) {
    alert('Select user and type message');
    return;
  }

  if (!currentChat.id || currentChat.id === 'undefined') {
    alert('Invalid recipient. Please select the seller again.');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: currentUser.id,
        receiver: currentChat.id,
        message: msg,
        senderName: currentUser.username
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || 'Failed to send message');
      return;
    }

    input.value = '';
    await loadConversations();
    await openConversation(currentChat.id, currentChat.name);
  } catch (e) {
    alert('Could not send message. Check your connection.');
  }
}


// ========== PROFILE ==========
let viewingUserProfile = null; // Track which user profile we're viewing

async function loadProfile() {
  try {
    const response = await fetch(`${API_URL}/users/${currentUser.id}`);
    const user = await response.json();

    document.getElementById('profileName').textContent = user.username;
    document.getElementById('profileBio').textContent = user.bio || 'No bio yet';
    document.getElementById('profileLocation').textContent = user.location || 'Kenya';
    document.getElementById('profileImage').src = user.profilePicture || 'https://via.placeholder.com/150';
    document.getElementById('followersCount').textContent = user.followers.length;
    document.getElementById('followingCount').textContent = user.following.length;
    
    // Hide follow button for own profile
    document.getElementById('followBtn').style.display = 'none';
    document.getElementById('messageBtn').style.display = 'none';
    
    viewingUserProfile = null;
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

// View other user's profile
async function viewUserProfile(userId, username) {
  try {
    const response = await fetch(`${API_URL}/users/${userId}`);
    const user = await response.json();

    document.getElementById('profileName').textContent = user.username;
    document.getElementById('profileBio').textContent = user.bio || 'No bio yet';
    document.getElementById('profileLocation').textContent = user.location || 'Kenya';
    document.getElementById('profileImage').src = user.profilePicture || 'https://via.placeholder.com/150';
    document.getElementById('followersCount').textContent = user.followers.length;
    document.getElementById('followingCount').textContent = user.following.length;
    
    // Show follow button for other users
    const followBtn = document.getElementById('followBtn');
    const messageBtn = document.getElementById('messageBtn');
    
    followBtn.style.display = 'block';
    messageBtn.style.display = 'block';
    
    // Check if already following
    if ((currentUser.following || []).includes(userId)) {
      followBtn.textContent = '✓ Following';
      followBtn.classList.add('following');
    } else {
      followBtn.textContent = 'Follow';
      followBtn.classList.remove('following');
    }
    
    viewingUserProfile = { id: userId, name: username };
    switchPage('profile');
  } catch (error) {
    console.error('Error loading user profile:', error);
  }
}

function toggleFollowUser() {
  if (!viewingUserProfile) {
    alert('No user selected');
    return;
  }

  if ((currentUser.following || []).includes(viewingUserProfile.id)) {
    unfollowUser(viewingUserProfile.id);
  } else {
    followUser(viewingUserProfile.id);
  }
}

async function followUser(userId) {
  try {
    const response = await fetch(`${API_URL}/users/${userId}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentUserId: currentUser.id })
    });

    if (response.ok) {
      currentUser.following.push(userId);
      localStorage.setItem('user', JSON.stringify(currentUser));
      
      const followBtn = document.getElementById('followBtn');
      followBtn.textContent = '✓ Following';
      followBtn.classList.add('following');
      
      alert('Following user!');
    }
  } catch (error) {
    console.error('Error following user:', error);
    alert('Error following user');
  }
}

async function unfollowUser(userId) {
  try {
    const response = await fetch(`${API_URL}/users/${userId}/unfollow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentUserId: currentUser.id })
    });

    if (response.ok) {
      currentUser.following = currentUser.following.filter(id => id !== userId);
      localStorage.setItem('user', JSON.stringify(currentUser));
      
      const followBtn = document.getElementById('followBtn');
      followBtn.textContent = 'Follow';
      followBtn.classList.remove('following');
      
      alert('Unfollowed user!');
    }
  } catch (error) {
    console.error('Error unfollowing user:', error);
    alert('Error unfollowing user');
  }
}

function openDirectMessage() {
  if (!viewingUserProfile) {
    alert('No user selected');
    return;
  }
  startConversation(viewingUserProfile.id, viewingUserProfile.name);
}

function editProfile() {
  if (viewingUserProfile) {
    alert('You can only edit your own profile');
    switchPage('profile');
    loadProfile();
    return;
  }

  const newBio = prompt('Enter your bio:');
  if (newBio !== null) {
    updateProfileBio(newBio);
  }
}

async function updateProfileBio(bio) {
  try {
    const response = await fetch(`${API_URL}/users/${currentUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio })
    });

    if (response.ok) {
      currentUser.bio = bio;
      localStorage.setItem('user', JSON.stringify(currentUser));
      loadProfile();
      alert('Profile updated!');
    }
  } catch (error) {
    console.error('Error updating profile:', error);
  }
}

// ========== LOGOUT ==========
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('lastPage');
  window.location.href = 'login.html';
}

// ========== MODALS ==========
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('show');
  }
});