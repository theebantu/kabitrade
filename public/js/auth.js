const API_URL = 'http://localhost:5000/api';

function toggleAuthForm(event) {
  event.preventDefault();

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  loginForm.classList.toggle('active');
  registerForm.classList.toggle('active');
}

// LOGIN
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = 'index.html';
    } else {
      showAuthMessage(data.error || 'Login failed', 'error');
    }
  } catch (error) {
    showAuthMessage('Cannot connect to server', 'error');
  }
});

// REGISTER
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('registerUsername').value;
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('registerConfirmPassword').value;

  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        confirmPassword
      })
    });

    const data = await response.json();

    if (response.ok) {
      showAuthMessage('Account created! Logging in...', 'success');
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1500);
    } else {
      showAuthMessage(data.error || 'Registration failed', 'error');
    }
  } catch (error) {
    showAuthMessage('Cannot connect to server', 'error');
  }
});

// FORGOT PASSWORD
document.getElementById('forgotPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('forgotEmail').value;

  try {
    const response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (response.ok) {
      showRecoveryMessage('Enter your email and new password below', 'success');
      document.getElementById('forgotPasswordForm').style.display = 'none';
      document.getElementById('resetPasswordForm').style.display = 'block';
      document.getElementById('resetEmail').value = email;
    } else {
      showRecoveryMessage(data.error || 'Error', 'error');
    }
  } catch (error) {
    showRecoveryMessage('Cannot connect to server', 'error');
  }
});

// RESET PASSWORD
document.getElementById('resetPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('resetEmail').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmNewPassword = document.getElementById('confirmNewPassword').value;

  if (newPassword !== confirmNewPassword) {
    showRecoveryMessage('Passwords do not match', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        newPassword,
        confirmPassword: confirmNewPassword
      })
    });

    const data = await response.json();

    if (response.ok) {
      showRecoveryMessage('Password reset successful! Redirecting...', 'success');

      setTimeout(() => {
        window.location.href = 'login.html';
      }, 2000);
    } else {
      showRecoveryMessage(data.error || 'Error resetting password', 'error');
    }
  } catch (error) {
    showRecoveryMessage('Cannot connect to server', 'error');
  }
});

function showAuthMessage(message, type) {
  const messageEl = document.getElementById('authMessage');
  messageEl.textContent = message;
  messageEl.className = `message ${type}`;
}

function showRecoveryMessage(message, type) {
  const messageEl = document.getElementById('recoveryMessage');
  messageEl.textContent = message;
  messageEl.className = `message ${type}`;
}