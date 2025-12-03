import { initAuth, getCurrentUser, isLoggedIn, signOut } from './auth.js';
import { getUserStats } from './stats.js';

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize authentication
    await initAuth();
    
    // Setup UI
    setupUI();
    
    // Load stats if logged in
    if (isLoggedIn()) {
        await loadUserStats();
    } else {
        showNotLoggedIn();
    }
});

function setupUI() {
    const backButton = document.getElementById('backButton');
    const authButton = document.getElementById('authButton');
    
    if (backButton) {
        backButton.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
    
    if (authButton) {
        if (isLoggedIn()) {
            const user = getCurrentUser();
            authButton.textContent = `Logged in as ${user.email}`;
            authButton.onclick = handleLogout;
        } else {
            authButton.textContent = 'Sign In';
            authButton.onclick = () => {
                window.location.href = '/';
            };
        }
    }
}

async function handleLogout() {
    if (confirm('Are you sure you want to sign out?')) {
        try {
            await signOut();
            window.location.href = '/';
        } catch (error) {
            console.error('Error signing out:', error);
            alert('Error signing out. Please try again.');
        }
    }
}

async function loadUserStats() {
    const user = getCurrentUser();
    
    try {
        const stats = await getUserStats(user.id);
        
        if (stats) {
            displayStats(stats);
        } else {
            // No stats yet, show zeros
            displayStats({
                points: 0,
                wins: 0,
                losses: 0,
                accuracy: 0,
                current_win_streak: 0,
                best_win_streak: 0,
                daily_streak: 0,
                best_daily_streak: 0
            });
        }
    } catch (error) {
        console.error('Error loading stats:', error);
        document.getElementById('loadingStats').innerHTML = `
            <h2 style="text-align: center; color: #ff6b6b;">Error loading stats</h2>
            <p style="text-align: center; color: #666;">Please try refreshing the page.</p>
        `;
    }
}

function displayStats(stats) {
    document.getElementById('loadingStats').classList.add('hidden');
    document.getElementById('statsDisplay').classList.remove('hidden');
    
    // Auto-calculate accuracy if it's missing or 0
    let accuracy = stats.accuracy || 0;
    const totalGuesses = (stats.wins || 0) + (stats.losses || 0);
    if (totalGuesses > 0 && accuracy === 0) {
        accuracy = ((stats.wins || 0) / totalGuesses) * 100;
        console.log('📊 Auto-calculated accuracy:', accuracy);
    }
    
    document.getElementById('points').textContent = stats.points || 0;
    document.getElementById('wins').textContent = stats.wins || 0;
    document.getElementById('losses').textContent = stats.losses || 0;
    document.getElementById('accuracy').textContent = `${Math.round(accuracy)}%`;
    document.getElementById('currentWinStreak').textContent = stats.current_win_streak || 0;
    document.getElementById('bestWinStreak').textContent = stats.best_win_streak || 0;
    document.getElementById('dailyStreak').textContent = stats.daily_streak || 0;
    document.getElementById('bestDailyStreak').textContent = stats.best_daily_streak || 0;
}

function showNotLoggedIn() {
    document.getElementById('loadingStats').classList.add('hidden');
    document.getElementById('notLoggedIn').classList.remove('hidden');
}
