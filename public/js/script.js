const API_URL = 'https://kabitrade.onrender.com/api';
const socket = io('https://kabitrade.onrender.com',{
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5});

let currentUser = null;
let currentPage = 'marketplace';
let currentChat = null;

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const user = localStorage.getItem('user');
  const lastPage = localStorage.getItem('lastPage');

  if (!token || !user) {
    window.location.href = 'login.html';
    return;
  }

  currentUser = JSON.parse(user);
  currentUser.following = currentUser.following || [];
  currentUser.followers = currentUser.followers || [];
  updateSidebar();

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
      const productHTML = `
        <div class="product">
          <div class="product-header">
  <div class="product-seller" onclick="viewUserProfile('${product.seller._id}', '${product.seller.username}')" style="cursor: pointer;">
    <img src="${product.seller.profilePicture}" alt="" class="author-pic">
    <div class="seller-name">${product.seller.username}</div>
  </div>
  <button class="action-btn" onclick="startConversation('${product.seller._id || product.seller.id}', '${product.seller.username}')">💬</button>
</div>
          <img src="${product.image}" alt="" class="product-image" onerror="this.src='https://via.placeholder.com/400'">
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
      const postHTML = `
        <div class="post">
          <div class="post-header">
            <div class="post-author" onclick="viewUserProfile('${post.author._id || post.author.id}', '${post.author.username}')" style="cursor: pointer;">
  <img src="${post.author.profilePicture}" alt="" class="author-pic">
  <div>
    <div class="author-name">${post.author.username}</div>
    <small style="color: #8e8e8e;">${post.category}</small>
  </div>
</div>
  <button class="action-btn" onclick="startConversation('${post.author._id || post.author.id}', '${post.author.username}')">💬</button>
          </div>
          ${post.media ? `<img src="${post.media}" alt="" class="post-image" onerror="this.src='https://via.placeholder.com/400'">` : ''}
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

  const category = document.getElementById('socialCategory').value;
  const content = document.getElementById('postContent').value;
  const imageFile = document.getElementById('socialImage').files[0];
  const uploadStatus = document.getElementById('socialUploadStatus');
  const submitBtn = document.getElementById('socialSubmitBtn');

  if (!category) {
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

      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        imageUrl = uploadData.imageUrl;
      }
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
        mediaType: 'image'
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
      throw new Error('Failed to create post');
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
  if (!userId || userId === 'undefined') {
    alert('Could not find this user. Please try again.');
    return;
  }
  if (userId === currentUser.id) {
    alert('You cannot message yourself.');
    return;
  }
  currentChat = { id: userId, name: userName };
  switchPage('messages');
  document.getElementById('chatHeader').innerHTML = `<h3>${userName}</h3>`;
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