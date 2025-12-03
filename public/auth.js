import { supabase } from './supabaseClient.js';

// Cookie helper functions
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

// Global auth state
let currentUser = null;

// Initialize auth state on page load
export async function initAuth() {
    console.log('🔐 Initializing auth...');
    
    try {
        // Check for existing session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('Auth error:', error);
        }
        
        console.log('Session check:', session ? 'Logged in' : 'Not logged in');
        
        if (session) {
            currentUser = session.user;
            updateUIForLoggedInUser(currentUser);
        } else {
            // Make sure logged out state is set
            updateUIForLoggedOutUser();
        }
        
        // Listen for auth changes
        supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Auth state changed:', event);
            
            if (event === 'SIGNED_IN' && session) {
                currentUser = session.user;
                updateUIForLoggedInUser(currentUser);
                closeLoginModal();
                
                // Initialize user stats if first time
                initializeUserStats(currentUser.id);
                
                // Save any pending answers from cookies to database
                await savePendingAnswersToDatabase(currentUser.id);
                
                // Reload the current view to update loginPrompt area
                console.log('🔄 Reloading view after sign in...');
                const activeView = document.querySelector('.view:not(.hidden)');
                if (activeView && activeView.id === 'resultsView') {
                    // User is viewing results - reload them
                    const questionId = document.getElementById('resultsQuestion').dataset.questionId || window.currentQuestion?.id;
                    if (questionId) {
                        console.log('🔄 Reloading results for question:', questionId);
                        await window.showResults(questionId);
                    }
                }
            } else if (event === 'SIGNED_OUT') {
                currentUser = null;
                updateUIForLoggedOutUser();
            }
        });
        
        console.log('✅ Auth initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing auth:', error);
    }
}

// Get current user
export function getCurrentUser() {
    return currentUser;
}

// Check if user is logged in
export function isLoggedIn() {
    return currentUser !== null;
}

// Send magic link
export async function sendMagicLink(email) {
    const { data, error } = await supabase.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: window.location.origin
        }
    });
    
    if (error) {
        throw error;
    }
    
    return data;
}

// Sign out
export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        throw error;
    }
}

// Update UI for logged in user
function updateUIForLoggedInUser(user) {
    const authButton = document.getElementById('authButton');
    const statsButton = document.getElementById('statsButton');
    const loginPrompt = document.getElementById('loginPrompt');
    
    if (authButton) {
        // Change to blue color when logged in
        authButton.classList.remove('auth-btn-logged-out');
        authButton.classList.add('auth-btn-logged-in');
        authButton.title = `Logged in as ${user.email} - Click to log out`;
        authButton.onclick = handleLogout;
    }
    
    if (statsButton) {
        statsButton.classList.remove('hidden');
        // Change to blue color when logged in
        statsButton.classList.remove('stats-btn-logged-out');
        statsButton.classList.add('stats-btn-logged-in');
    }
    
    if (loginPrompt) {
        loginPrompt.classList.add('hidden');
    }
}

// Update UI for logged out user
function updateUIForLoggedOutUser() {
    console.log('Updating UI for logged out user...');
    
    const authButton = document.getElementById('authButton');
    const statsButton = document.getElementById('statsButton');
    const loginPrompt = document.getElementById('loginPrompt');
    
    if (authButton) {
        console.log('Setting up auth button click handler');
        // Change to red color when logged out
        authButton.classList.remove('auth-btn-logged-in');
        authButton.classList.add('auth-btn-logged-out');
        authButton.title = 'Sign in to save your stats';
        authButton.onclick = showLoginModal;
    } else {
        console.error('Auth button not found!');
    }
    
    // Keep stats button visible but disable functionality when logged out
    if (statsButton) {
        statsButton.classList.remove('hidden');
        // Change to red color when logged out
        statsButton.classList.remove('stats-btn-logged-in');
        statsButton.classList.add('stats-btn-logged-out');
    }
    
    if (loginPrompt) {
        loginPrompt.classList.remove('hidden');
    }
}

// Handle logout
async function handleLogout() {
    if (confirm('Are you sure you want to sign out?')) {
        try {
            await signOut();
        } catch (error) {
            console.error('Error signing out:', error);
            alert('Error signing out. Please try again.');
        }
    }
}

// Show login modal
export function showLoginModal() {
    console.log('📧 Opening login modal...');
    const modal = document.getElementById('loginModal');
    if (modal) {
        console.log('Modal found, showing it');
        modal.classList.remove('hidden');
        
        // Focus on email input
        setTimeout(() => {
            const emailInput = document.getElementById('loginEmail');
            if (emailInput) {
                emailInput.focus();
            }
        }, 100);
    } else {
        console.error('❌ Login modal not found in DOM!');
    }
}

// Close login modal
function closeLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Clear email input
    const emailInput = document.getElementById('loginEmail');
    if (emailInput) {
        emailInput.value = '';
    }
    
    // Hide success message
    const successMsg = document.getElementById('loginSuccess');
    if (successMsg) {
        successMsg.classList.add('hidden');
    }
}

// Handle login form submission
export function setupLoginForm() {
    const loginForm = document.getElementById('loginForm');
    const closeModalBtn = document.getElementById('closeLoginModal');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('loginEmail').value;
            const errorMsg = document.getElementById('loginError');
            const successMsg = document.getElementById('loginSuccess');
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            
            // Clear previous messages
            errorMsg.classList.add('hidden');
            successMsg.classList.add('hidden');
            
            // Disable button
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';
            
            try {
                await sendMagicLink(email);
                
                // Show success message
                successMsg.classList.remove('hidden');
                
                // Clear form
                document.getElementById('loginEmail').value = '';
                
            } catch (error) {
                console.error('Error sending magic link:', error);
                errorMsg.textContent = error.message || 'Failed to send magic link. Please try again.';
                errorMsg.classList.remove('hidden');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Magic Link';
            }
        });
    }
    
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeLoginModal);
    }
}

// Initialize user stats in database
async function initializeUserStats(userId) {
    try {
        // Check if stats already exist
        const { data: existingStats } = await supabase
            .from('user_stats')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        if (!existingStats) {
            // Create initial stats
            await supabase
                .from('user_stats')
                .insert({
                    user_id: userId,
                    points: 0,
                    wins: 0,
                    losses: 0,
                    current_win_streak: 0,
                    best_win_streak: 0,
                    daily_streak: 0,
                    best_daily_streak: 0,
                    last_answered_date: null,
                    accuracy: 0
                });
        }
    } catch (error) {
        console.error('Error initializing user stats:', error);
    }
}

// Save pending answers from cookies to database on login
async function savePendingAnswersToDatabase(userId) {
    try {
        // Get pending answers from cookies
        const guessDataCookie = getCookie('guess_data');
        if (!guessDataCookie) {
            console.log('📝 No pending answers to save');
            return;
        }
        
        const guessData = JSON.parse(guessDataCookie);
        const questionIds = Object.keys(guessData);
        
        if (questionIds.length === 0) {
            console.log('📝 No pending answers to save');
            return;
        }
        
        console.log(`📝 Found ${questionIds.length} pending answer(s) in cookies`);
        
        // Check which questions already have answers in database
        const { data: existingAnswers, error: fetchError } = await supabase
            .from('poll_answers')
            .select('question_id')
            .eq('user_id', userId)
            .in('question_id', questionIds);
        
        if (fetchError) {
            console.error('Error fetching existing answers:', fetchError);
            return;
        }
        
        const existingQuestionIds = new Set((existingAnswers || []).map(a => a.question_id));
        
        // Save answers that don't already exist
        let savedCount = 0;
        for (const questionId of questionIds) {
            if (existingQuestionIds.has(questionId)) {
                console.log(`⏭️ Skipping ${questionId} - already answered in database`);
                continue;
            }
            
            const answerData = guessData[questionId];
            
            // Insert into database
            const { error: insertError } = await supabase
                .from('poll_answers')
                .insert({
                    user_id: userId,
                    question_id: questionId,
                    answer: answerData.answer,
                    prediction: answerData.prediction || answerData.guess, // Support both property names
                    correct: null
                });
            
            if (insertError) {
                console.error(`Error saving answer for ${questionId}:`, insertError);
            } else {
                console.log(`✅ Saved answer for ${questionId} to database`);
                savedCount++;
            }
        }
        
        console.log(`📊 Saved ${savedCount} of ${questionIds.length} pending answer(s) to database`);
        
        // Clear cookies after successful save
        if (savedCount > 0) {
            setCookie('guess_data', JSON.stringify({}), 365);
            console.log('🧹 Cleared cookie answers');
        }
        
    } catch (error) {
        console.error('Error saving pending answers:', error);
    }
}
