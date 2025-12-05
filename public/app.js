import { initAuth, setupLoginForm, getCurrentUser, isLoggedIn } from './auth.js';
import { savePollResponse, syncPollToDatabase } from './stats.js';
import { supabase } from './supabaseClient.js';

// Global state
let isViewingFromYesterdayButton = false;
let yesterdayQuestionData = null;

// Cookie Helper Functions
function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function getAnsweredQuestions() {
    const answered = getCookie('answered_questions');
    return answered ? JSON.parse(answered) : {};
}

function markQuestionAnswered(questionId) {
    const answered = getAnsweredQuestions();
    answered[questionId] = true;
    setCookie('answered_questions', JSON.stringify(answered), 365);
}

function hasAnsweredQuestion(questionId) {
    const answered = getAnsweredQuestions();
    return answered[questionId] === true;
}

// Check if user has answered a question in the database
async function hasAnsweredQuestionInDB(questionId) {
    if (!isLoggedIn()) {
        // If not logged in, fall back to cookie check
        return hasAnsweredQuestion(questionId);
    }
    
    const user = getCurrentUser();
    
    try {
        const { data, error } = await supabase
            .from('poll_answers')
            .select('id')
            .eq('user_id', user.id)
            .eq('question_id', questionId)
            .maybeSingle();
        
        if (error && error.code !== 'PGRST116') {
            console.error('Error checking answered status:', error);
            return false;
        }
        
        return !!data; // Returns true if data exists
    } catch (error) {
        console.error('Error checking database:', error);
        return hasAnsweredQuestion(questionId); // Fallback to cookie
    }
}

// Get user's answer and prediction from database
async function getAnswerAndPredictionFromDB(questionId) {
    if (!isLoggedIn()) {
        return null;
    }
    
    const user = getCurrentUser();
    
    try {
        const { data, error } = await supabase
            .from('poll_answers')
            .select('answer, prediction')
            .eq('user_id', user.id)
            .eq('question_id', questionId)
            .maybeSingle();
        
        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching answer/prediction:', error);
            return null;
        }
        
        return data; // Returns { answer, prediction } or null
    } catch (error) {
        console.error('Error fetching from database:', error);
        return null;
    }
}

// Save guess data for later stats processing
function saveGuessData(questionId, guessData) {
    const allGuesses = getGuessData();
    allGuesses[questionId] = guessData;
    setCookie('guess_data', JSON.stringify(allGuesses), 365);
}

// Save answer to database immediately (before results unlock)
async function saveAnswerToDatabase(questionId, answer, prediction) {
    if (!isLoggedIn()) return;
    
    const user = getCurrentUser();
    
    try {
        // Check if answer already exists
        const { data: existing } = await supabase
            .from('poll_answers')
            .select('id')
            .eq('user_id', user.id)
            .eq('question_id', questionId)
            .maybeSingle();
        
        if (!existing) {
            // Insert new answer with prediction (correct will be null until results unlock)
            const { error } = await supabase
                .from('poll_answers')
                .insert({
                    user_id: user.id,
                    question_id: questionId,
                    answer: answer,
                    prediction: prediction,
                    correct: null // Will be updated when results unlock
                });
            
            if (error) {
                console.error('Error inserting answer:', error);
            } else {
                console.log('✅ Answer and prediction saved to database');
            }
        } else {
            console.log('Answer already exists in database');
        }
    } catch (error) {
        console.error('Error saving answer to database:', error);
    }
}

// Get all guess data
function getGuessData() {
    const data = getCookie('guess_data');
    return data ? JSON.parse(data) : {};
}

// Process guess when results unlock
async function processGuessIfResultsUnlocked(questionId, results) {
    if (!isLoggedIn() || !results || results.length === 0) return;
    
    const guessData = getGuessData();
    const userGuess = guessData[questionId];
    
    if (!userGuess) return;
    
    // Find the majority answer (highest percentage)
    const sortedResults = [...results].sort((a, b) => b.percentage - a.percentage);
    const majorityAnswer = sortedResults[0].choice;
    
    // Check if user's prediction was correct
    const wasCorrect = userGuess.prediction === majorityAnswer;
    
    // Save to database
    await savePollResponse(
        questionId,
        userGuess.answer,
        userGuess.prediction,
        majorityAnswer
    );
    
    // Remove from pending predictions
    delete guessData[questionId];
    setCookie('guess_data', JSON.stringify(guessData), 365);
}

// View Management
function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');
}

// Global State
let currentQuestion = null;
let selectedAnswer = null;
let selectedGuess = null;

// Make showResults accessible globally for auth reload
window.showResults = showResults;
window.currentQuestion = currentQuestion;

// Initialize App
async function init() {
    try {
        const response = await fetch('/api/today');
        
        // Handle 404 - no question for today
        if (!response.ok) {
            document.getElementById('loadingScreen').classList.add('hidden');
            const questionView = document.getElementById('questionView');
            questionView.classList.remove('hidden');
            questionView.innerHTML = `
                <div class="question-card" style="text-align: center; padding: 40px;">
                    <h2 style="color: #667eea; margin-bottom: 20px;">📅 No Question Today</h2>
                    <p style="color: #64748b; font-size: 1.1rem; margin-bottom: 30px;">Check back tomorrow for a new question!</p>
                    <p style="color: #94a3b8; font-size: 0.9rem;">Or browse past questions below ⬇️</p>
                </div>
            `;
            await loadPastQuestions();
            return;
        }
        
        const todayQuestion = await response.json();
        currentQuestion = todayQuestion;
        window.currentQuestion = currentQuestion; // Update window reference
        
        // Check if question is locked (1+ days old)
        if (!todayQuestion.canAnswer) {
            // Question is locked but results not ready yet
            if (!todayQuestion.canViewResults) {
                showLockedView(todayQuestion);
                await loadPastQuestions();
            } else {
                // Results are ready, show them
                await showResults(todayQuestion.id);
                await loadPastQuestions();
            }
        }
        // Check if user already answered today's question (check DB if logged in)
        else if (await hasAnsweredQuestionInDB(todayQuestion.id)) {
            // Skip to results (or placeholder if locked)
            await showResults(todayQuestion.id);
            await loadPastQuestions();
        } else {
            // Show today's question
            displayQuestion(todayQuestion);
        }
    } catch (error) {
        console.error('Error loading today\'s question:', error);
        document.getElementById('questionText').textContent = 'Error loading question. Please refresh the page.';
    }
}

// Display Question
function displayQuestion(question) {
    // Hide loading screen
    document.getElementById('loadingScreen').classList.add('hidden');
    
    // Update global reference
    currentQuestion = question;
    window.currentQuestion = question;
    
    // Display hero image if available
    const heroImage = document.getElementById('questionHeroImage');
    if (question.imageUrl) {
        heroImage.style.backgroundImage = `url('${question.imageUrl}')`;
        heroImage.style.display = 'block';
    } else {
        heroImage.style.display = 'none';
    }
    
    document.getElementById('questionText').textContent = question.question;
    
    // Format and display date
    const dateElement = document.getElementById('questionDate');
    if (dateElement) {
        dateElement.textContent = formatDate(question.date);
    }
    
    const choicesContainer = document.getElementById('choicesContainer');
    choicesContainer.innerHTML = '';
    
    question.choices.forEach(choice => {
        const button = document.createElement('button');
        button.className = 'choice-button';
        button.textContent = choice;
        button.onclick = () => selectAnswer(choice);
        choicesContainer.appendChild(button);
    });
    
    // Show submit button now that content is loaded
    document.getElementById('submitAnswer').classList.remove('hidden');
    
    showView('questionView');
}

// Select Answer
function selectAnswer(answer) {
    selectedAnswer = answer;
    
    // Update UI
    document.querySelectorAll('#choicesContainer .choice-button').forEach(btn => {
        if (btn.textContent === answer) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
    
    document.getElementById('submitAnswer').disabled = false;
}

// Submit Answer and Move to Guess View
document.getElementById('submitAnswer').addEventListener('click', () => {
    if (!selectedAnswer) return;

    document.getElementById('userChoiceText').textContent = selectedAnswer;
    
    // Display hero image with gradient overlay in guess view
    const guessHeroImage = document.getElementById('guessHeroImage');
    if (currentQuestion.imageUrl) {
        guessHeroImage.style.backgroundImage = `linear-gradient(135deg, rgba(236, 72, 153, 0.3) 0%, rgba(168, 85, 247, 0.3) 100%), url('${currentQuestion.imageUrl}')`;
        guessHeroImage.style.backgroundBlendMode = 'multiply';
        guessHeroImage.style.display = 'block';
    } else {
        guessHeroImage.style.display = 'none';
    }
    
    // Update heading based on number of choices
    const guessHeading = document.getElementById('guessViewHeading');
    if (currentQuestion.choices.length === 2) {
        guessHeading.textContent = 'Which will be more popular?';
    } else {
        guessHeading.textContent = 'Which will be most popular?';
    }
    
    // Show guess view with styled subtitle
    const guessSubtitle = document.getElementById('guessSubtitle');
    guessSubtitle.innerHTML = `You chose <em>${selectedAnswer}</em>`;
    
    const guessContainer = document.getElementById('guessChoicesContainer');
    guessContainer.innerHTML = '';
    
    currentQuestion.choices.forEach(choice => {
        const button = document.createElement('button');
        button.className = 'choice-button';
        button.textContent = choice;
        button.onclick = () => selectGuess(choice);
        guessContainer.appendChild(button);
    });
    
    showView('guessView');
});

// Select Guess
function selectGuess(guess) {
    selectedGuess = guess;
    
    // Update UI
    document.querySelectorAll('#guessChoicesContainer .choice-button').forEach(btn => {
        if (btn.textContent === guess) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
    
    document.getElementById('submitGuess').disabled = false;
}

// Submit Guess and Show Results
document.getElementById('submitGuess').addEventListener('click', async () => {
    if (!selectedGuess) return;
    
    try {
        // Submit vote
        await fetch('/api/vote', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                questionId: currentQuestion.id,
                answer: selectedAnswer,
                majorityGuess: selectedGuess
            })
        });
        
        // Mark as answered
        markQuestionAnswered(currentQuestion.id);
        
        // Save prediction data for showing in results (for all users)
        const predictionData = {
            questionId: currentQuestion.id,
            answer: selectedAnswer,
            prediction: selectedGuess,
            timestamp: new Date().toISOString()
        };
        saveGuessData(currentQuestion.id, predictionData);
        
        console.log('💾 DEBUG - Saved prediction data:', predictionData);
        
        // Save answer to database immediately if logged in
        if (isLoggedIn()) {
            // Save to database immediately (with correct: null until results unlock)
            await saveAnswerToDatabase(currentQuestion.id, selectedAnswer, selectedGuess);
        }
        
        // Show results
        await showResults(currentQuestion.id);
        
        // Load past questions
        await loadPastQuestions();
        
        // Reset selections
        selectedAnswer = null;
        selectedGuess = null;
        
    } catch (error) {
        console.error('Error submitting vote:', error);
        alert('Error submitting your vote. Please try again.');
    }
});

// Track which questions have had their results viewed
function hasViewedResults(questionId) {
    const viewedData = getCookie('viewed_results');
    if (!viewedData) return false;
    const viewed = JSON.parse(viewedData);
    return viewed.includes(questionId);
}

function markResultsAsViewed(questionId) {
    const viewedData = getCookie('viewed_results');
    let viewed = viewedData ? JSON.parse(viewedData) : [];
    if (!viewed.includes(questionId)) {
        viewed.push(questionId);
        setCookie('viewed_results', JSON.stringify(viewed), 365);
    }
}

// Show Results
async function showResults(questionId, forceAnimation = false) {
    try {
        const response = await fetch(`/api/results/${questionId}`);
        const data = await response.json();
        
        const resultsQuestionEl = document.getElementById('resultsQuestion');
        resultsQuestionEl.textContent = data.question;
        resultsQuestionEl.dataset.questionId = questionId; // Store for reload
        
        // Format and display date
        const dateElement = document.getElementById('resultsDate');
        if (dateElement && data.date) {
            dateElement.textContent = formatDate(data.date);
        }
        
        // Get user's answer and prediction from database (if logged in) or cookies (if not)
        let userAnswerPrediction = null;
        
        if (isLoggedIn()) {
            // Fetch from database
            userAnswerPrediction = await getAnswerAndPredictionFromDB(questionId);
        } else {
            // Fallback to cookies
            const guessData = getGuessData();
            const cookieData = guessData[questionId];
            if (cookieData) {
                userAnswerPrediction = {
                    answer: cookieData.answer,
                    prediction: cookieData.prediction || cookieData.guess // Support both new and old cookie format
                };
            }
        }
        
        // Update subtitle showing what user chose and predicted
        const subtitleElement = document.getElementById('resultsSubtitle');
        
        if (subtitleElement) {
            if (userAnswerPrediction) {
                // Show on separate lines, left-aligned
                if (userAnswerPrediction.prediction) {
                    subtitleElement.innerHTML = `
                        <div>You chose <strong>${userAnswerPrediction.answer}</strong></div>
                        <div>You predicted <strong>${userAnswerPrediction.prediction}</strong></div>
                    `;
                } else {
                    // Show only answer if prediction is missing
                    subtitleElement.innerHTML = `<div>You chose <strong>${userAnswerPrediction.answer}</strong></div>`;
                }
                subtitleElement.style.display = 'block';
            } else {
                subtitleElement.style.display = 'none';
            }
        }
        
        const resultsContainer = document.getElementById('resultsContainer');
        resultsContainer.innerHTML = '';
        
        // Check if results are locked (not yet available)
        if (data.locked) {
            // Show placeholder with Thanks - Large & Centered style
            const placeholder = document.createElement('div');
            placeholder.className = 'results-placeholder';
            placeholder.innerHTML = `
                <div class="thanks-large">Thanks for voting!</div>
                <p style="color: #6b7280; font-size: 0.95rem; margin-bottom: 24px;">Results will be available tomorrow</p>
                
                <div class="locked-countdown">
                    <div class="countdown-box">
                        <div class="countdown-number" id="lockedHours">--</div>
                        <div class="countdown-label-small">HOURS</div>
                    </div>
                    <div class="countdown-box">
                        <div class="countdown-number" id="lockedMinutes">--</div>
                        <div class="countdown-label-small">MINS</div>
                    </div>
                    <div class="countdown-box">
                        <div class="countdown-number" id="lockedSeconds">--</div>
                        <div class="countdown-label-small">SECS</div>
                    </div>
                </div>
                
                <div class="live-indicator">
                    <div class="live-dot"></div>
                    <span>Live votes counting</span>
                </div>
            `;
            resultsContainer.appendChild(placeholder);
            
            showView('resultsView');
            
            // Start locked countdown
            startLockedCountdown();
            
            // Handle yesterday's results button vs login prompt
            const loginPrompt = document.getElementById('loginPrompt');
            
            if (loginPrompt) {
                if (isLoggedIn()) {
                    // User IS logged in - show yesterday's results button
                    loginPrompt.innerHTML = ''; // Clear any existing content
                    const yesterdayButton = await createYesterdayResultsButton();
                    if (yesterdayButton) {
                        loginPrompt.appendChild(yesterdayButton);
                        loginPrompt.style.setProperty('display', 'block', 'important');
                        loginPrompt.style.visibility = 'visible';
                        loginPrompt.style.opacity = '1';
                    } else {
                        loginPrompt.style.display = 'none';
                    }
                } else {
                    // User is NOT logged in - show normal signin card
                    loginPrompt.innerHTML = `
                        <p>💾 Save your stats in one click</p>
                        <button onclick="document.getElementById('authButton').click()" class="btn-signin">
                            Sign in
                        </button>
                    `;
                    loginPrompt.style.display = 'block';
                }
            }
        } else {
            // Check if user has seen these results before
            const alreadyViewed = hasViewedResults(questionId);
            
            // Play animation if: forced, OR first time viewing
            if (forceAnimation || !alreadyViewed) {
                // Show dramatic reveal animation
                await playRevealAnimation(questionId, data, userAnswerPrediction);
                markResultsAsViewed(questionId);
            } else {
                // Already viewed - show results instantly
                await showResultsInstantly(questionId, data);
            }
            
            // Process stats if results are unlocked and user has a pending guess
            await processGuessIfResultsUnlocked(questionId, data.results);
        }
        
    } catch (error) {
        console.error('Error loading results:', error);
    }
}

// Show Results Instantly (no animation)
async function showResultsInstantly(questionId, data) {
    const sortedResults = [...data.results].sort((a, b) => b.percentage - a.percentage);
    
    const resultsContainer = document.getElementById('resultsContainer');
    const introStage = document.getElementById('revealIntroStage');
    
    // Hide intro stage
    introStage.classList.add('hidden');
    
    // Show results view
    showView('resultsView');
    
    // Scroll to top
    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
    
    // Build and show results immediately (no animation)
    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'block';
    
    sortedResults.forEach((result) => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        
        resultItem.innerHTML = `
            <div class="result-label">
                <span>${result.choice}</span>
                <span class="result-percentage">${result.percentage}%</span>
            </div>
            <div class="result-bar-container">
                <div class="result-bar" style="width: ${result.percentage}%"></div>
            </div>
        `;
        
        resultsContainer.appendChild(resultItem);
    });
}

// Play Reveal Animation
async function playRevealAnimation(questionId, data, userAnswerGuess) {
    const sortedResults = [...data.results].sort((a, b) => b.percentage - a.percentage);
    
    const resultsContainer = document.getElementById('resultsContainer');
    const introStage = document.getElementById('revealIntroStage');
    const choiceLine = document.getElementById('revealChoiceLine');
    const resultsQuestion = document.getElementById('resultsQuestion');
    const resultsSubtitle = document.getElementById('resultsSubtitle');
    const resultsDate = document.getElementById('resultsDate');
    
    // CLEAR OLD TEXT from previous animation
    choiceLine.innerHTML = '';
    choiceLine.style.animation = 'none';
    choiceLine.style.opacity = '0';
    
    // Hide the normal results elements initially (except question which stays visible)
    resultsContainer.style.display = 'none';
    resultsQuestion.style.opacity = '1'; // Keep question visible during animation
    resultsSubtitle.style.opacity = '0';
    resultsDate.style.opacity = '0';
    
    // Show intro stage
    introStage.classList.remove('hidden');
    
    // Show the results view
    showView('resultsView');
    
    // Scroll to top of page to show space above card
    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
    
    // Build results HTML but don't show yet
    sortedResults.forEach((result) => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        
        resultItem.innerHTML = `
            <div class="result-label">
                <span>${result.choice}</span>
                <span class="result-percentage" data-final="${result.percentage}">0%</span>
            </div>
            <div class="result-bar-container">
                <div class="result-bar" data-final="${result.percentage}" style="width: 0%"></div>
            </div>
        `;
        
        resultsContainer.appendChild(resultItem);
    });
    
    // Phase 1: Show "You chose..." at 2s
    if (userAnswerGuess) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        choiceLine.innerHTML = `You chose <strong>${userAnswerGuess.answer}</strong>`;
        choiceLine.style.animation = 'revealChoiceIn 420ms ease-out forwards';
        
        // Phase 1b: Show "You predicted..." after 2s
        await new Promise(resolve => setTimeout(resolve, 2000));
        choiceLine.style.animation = 'none';
        await new Promise(resolve => setTimeout(resolve, 10)); // Force reflow
        choiceLine.innerHTML = `You predicted <strong>${userAnswerGuess.prediction}</strong>`;
        choiceLine.style.animation = 'revealChoiceIn 420ms ease-out forwards';
        
        // Let "You predicted" stay for 2 seconds before fading
        await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
        // Generic reveal - just show banner, skip straight to results after 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Phase 2: Fade out intro, fade in results
    introStage.style.animation = 'revealFadeOut 400ms ease forwards';
    await new Promise(resolve => setTimeout(resolve, 400));
    introStage.classList.add('hidden');
    introStage.style.animation = 'none';
    
    // Show results elements (question already visible, just fade in subtitle and date)
    resultsContainer.style.display = 'block';
    resultsSubtitle.style.animation = 'revealFadeIn 400ms ease forwards';
    resultsDate.style.animation = 'revealFadeIn 400ms ease forwards';
    resultsSubtitle.style.opacity = '1';
    resultsDate.style.opacity = '1';
    
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Phase 3: Scramble numbers super fast for 2 seconds
    const percentEls = Array.from(document.querySelectorAll('.result-percentage'));
    const scrambleStart = performance.now();
    const scrambleDuration = 2000;
    
    const scrambleInterval = setInterval(async () => {
        const elapsed = performance.now() - scrambleStart;
        if (elapsed >= scrambleDuration) {
            clearInterval(scrambleInterval);
            // Reset to 0% before counting up
            percentEls.forEach(el => el.textContent = '0%');
            
            // Phase 4: Count up numbers in sync with bars
            setTimeout(async () => {
                await animateBarsAndNumbers(sortedResults);
                
                // If viewing from yesterday button, show correctness after animation
                if (isViewingFromYesterdayButton && userAnswerGuess) {
                    await showYesterdayCorrectness(questionId, data, userAnswerGuess);
                    isViewingFromYesterdayButton = false;
                    yesterdayQuestionData = null;
                }
            }, 100);
        } else {
            // Super fast scramble
            percentEls.forEach(el => {
                el.textContent = Math.floor(Math.random() * 101) + '%';
            });
        }
    }, 30); // Very fast - 30ms
}

// Animate bars and count up numbers in sync
function animateBarsAndNumbers(sortedResults) {
    return new Promise((resolve) => {
        const duration = 2000; // 2 seconds
        const startTime = performance.now();
        const barEls = Array.from(document.querySelectorAll('.result-bar'));
        const percentEls = Array.from(document.querySelectorAll('.result-percentage'));
        
        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeOutCubic(progress);
            
            barEls.forEach((bar, i) => {
                const finalVal = parseInt(bar.dataset.final, 10);
                const currentVal = Math.round(eased * finalVal);
                bar.style.width = currentVal + '%';
                percentEls[i].textContent = currentVal + '%';
            });
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                resolve(); // Animation complete!
            }
        }
        
        animate();
    });
}

// Easing function
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Show Locked View with Countdown
function showLockedView(question) {
    console.log('🔒 Showing locked view for:', question.id);
    
    // Set locked question
    document.getElementById('lockedQuestion').textContent = question.question;
    
    // Display hero image
    const lockedHeroImage = document.getElementById('lockedHeroImage');
    if (question.imageUrl) {
        lockedHeroImage.style.backgroundImage = `url('${question.imageUrl}')`;
        lockedHeroImage.style.display = 'block';
    } else {
        lockedHeroImage.style.display = 'none';
    }
    
    // Hide loading screen
    document.getElementById('loadingScreen').classList.add('hidden');
    
    // Start countdown timer
    startCountdown(question.date);
    
    // Set up sign in button
    document.getElementById('lockedSignInBtn').onclick = () => {
        document.getElementById('authButton').click();
    };
    
    showView('lockedView');
}

// Countdown Timer
function startCountdown(publishDate) {
    // Results unlock at midnight tomorrow (next day at 00:00:00)
    const unlockTime = new Date(publishDate);
    unlockTime.setDate(unlockTime.getDate() + 1);
    unlockTime.setHours(0, 0, 0, 0);
    
    console.log('⏰ Countdown to:', unlockTime);
    
    function updateCountdown() {
        const now = new Date();
        const diff = unlockTime - now;
        
        if (diff <= 0) {
            document.getElementById('hoursLeft').textContent = '00';
            document.getElementById('minsLeft').textContent = '00';
            document.getElementById('secsLeft').textContent = '00';
            return;
        }
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);
        
        document.getElementById('hoursLeft').textContent = String(hours).padStart(2, '0');
        document.getElementById('minsLeft').textContent = String(mins).padStart(2, '0');
        document.getElementById('secsLeft').textContent = String(secs).padStart(2, '0');
        
        setTimeout(updateCountdown, 1000);
    }
    
    updateCountdown();
}

// Load Past Questions
async function loadPastQuestions() {
    try {
        const response = await fetch('/api/past-questions');
        const pastQuestions = await response.json();
        
        // Update ONLY Locked and Results screens (NOT Prediction)
        const listContainerLocked = document.getElementById('pastQuestionsListLocked');
        const listContainerResults = document.getElementById('pastQuestionsListResults');
        
        // Clear both
        if (listContainerLocked) listContainerLocked.innerHTML = '';
        if (listContainerResults) listContainerResults.innerHTML = '';
        
        if (pastQuestions.length === 0) {
            const emptyMessage = '<p style="text-align: center; color: #999;">No past questions yet. Check back tomorrow!</p>';
            if (listContainer) listContainer.innerHTML = emptyMessage;
            if (listContainerLocked) listContainerLocked.innerHTML = emptyMessage;
            if (listContainerResults) listContainerResults.innerHTML = emptyMessage;
        } else {
            // Process all questions and check answered status
            for (const question of pastQuestions) {
                
                // Create item for Locked screen
                if (listContainerLocked) {
                    const itemLocked = await createPastQuestionItem(question);
                    listContainerLocked.appendChild(itemLocked);
                }
                
                // Create item for Results screen - NEW
                if (listContainerResults) {
                    const itemResults = await createPastQuestionItem(question);
                    listContainerResults.appendChild(itemResults);
                }
            }
        }
        
    } catch (error) {
        console.error('Error loading past questions:', error);
    }
}

// Helper function to create past question item
async function createPastQuestionItem(question) {
    const item = document.createElement('div');
    item.className = 'past-poll-card';
    
    const isAnswered = await hasAnsweredQuestionInDB(question.id);
    
    // Get user's choice and prediction from database (if logged in) or cookies (if not)
    let userAnswerPrediction = null;
    
    if (isLoggedIn()) {
        // Fetch from database
        userAnswerPrediction = await getAnswerAndPredictionFromDB(question.id);
    } else {
        // Fallback to cookies
        const guessData = getGuessData();
        const cookieData = guessData[question.id];
        if (cookieData) {
            userAnswerPrediction = {
                answer: cookieData.answer,
                prediction: cookieData.prediction || cookieData.guess
            };
        }
    }
    
    // Gradient classes for variety
    const gradients = ['gradient-1', 'gradient-2', 'gradient-3', 'gradient-4'];
    const gradientClass = gradients[Math.floor(Math.random() * gradients.length)];
    
    // Use imageUrl if available
    const imageUrl = question.imageUrl || '';
    
    // Determine status badge - NEW FORMAT
    let statusBadge = '';
    let statusClass = '';
    if (question.canAnswer && !isAnswered) {
        // Can still answer
        statusBadge = '→ Make Prediction';
        statusClass = 'unanswered';
    } else {
        // Already answered or results available
        statusBadge = '✓ Predicted';
        statusClass = 'answered';
    }
    
    item.innerHTML = `
        <div class="past-poll-hero ${gradientClass}" style="${imageUrl ? `background-image: url('${imageUrl}');` : ''}"></div>
        <div class="past-poll-content">
            <div class="past-poll-question">${question.question}</div>
            <div class="past-poll-meta">
                <div class="past-poll-votes"></div>
                <div class="past-poll-status ${statusClass}">
                    ${statusBadge}
                </div>
            </div>
        </div>
    `;
    
    item.onclick = () => loadPastQuestion(question);
    
    return item;
}

// Format Date
function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const options = { month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Load Past Question
async function loadPastQuestion(question, forceAnimation = false) {
    currentQuestion = question;
    
    // If question is locked (1+ days old), always show results
    if (!question.canAnswer) {
        await showResults(question.id, forceAnimation);
        // Scroll to top to see results
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    
    // Check if already answered (check DB if logged in)
    if (await hasAnsweredQuestionInDB(question.id)) {
        await showResults(question.id, forceAnimation);
        // Scroll to top to see results
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        // Reset selections
        selectedAnswer = null;
        selectedGuess = null;
        
        // Hide past questions view
        document.getElementById('pastQuestionsView').classList.add('hidden');
        
        // Display the question
        displayQuestion(question);
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize authentication
    await initAuth();
    setupLoginForm();
    
    // Setup logo click - return to home/reload
    const navLogo = document.querySelector('.nav-logo');
    if (navLogo) {
        navLogo.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
    
    // Setup stats button
    const statsButton = document.getElementById('statsButton');
    if (statsButton) {
        statsButton.addEventListener('click', () => {
            if (isLoggedIn()) {
                window.location.href = '/stats.html';
            } else {
                // Prompt user to log in
                if (confirm('You need to sign in to view your stats. Sign in now?')) {
                    const authButton = document.getElementById('authButton');
                    if (authButton) {
                        authButton.click();
                    }
                }
            }
        });
    }
    
    // Setup auth button as backup (auth.js should handle this, but just in case)
    const authButton = document.getElementById('authButton');
    if (authButton && authButton.textContent.includes('Sign in')) {
        authButton.addEventListener('click', () => {
            const modal = document.getElementById('loginModal');
            if (modal) {
                modal.classList.remove('hidden');
            }
        });
    }
    
    // Start main app
    init();
});

// Locked Results Countdown Timer
let lockedCountdownInterval;

// Show correctness result in yesterday card after animation completes
async function showYesterdayCorrectness(questionId, data, userAnswerGuess) {
    const loginPrompt = document.getElementById('loginPrompt');
    if (!loginPrompt) return;
    
    // Determine if prediction was correct
    const sortedResults = [...data.results].sort((a, b) => b.percentage - a.percentage);
    const winningChoice = sortedResults[0].choice;
    const wasCorrect = userAnswerGuess.prediction === winningChoice;
    
    // Replace yesterday card with correctness message
    loginPrompt.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'yesterday-results-card correctness-card';
    
    if (wasCorrect) {
        card.innerHTML = `
            <div class="stat-header">
                <span class="stat-icon">🎯</span>
                <span class="stat-title correct">Prediction: Correct</span>
            </div>
            <div class="stat-message">You matched the majority vote!</div>
            <div class="stat-detail">Great prediction skills 👏</div>
        `;
    } else {
        card.innerHTML = `
            <div class="stat-header">
                <span class="stat-icon">🎲</span>
                <span class="stat-title incorrect">Prediction: Missed</span>
            </div>
            <div class="stat-message">You didn't match the majority this time</div>
            <div class="stat-detail">Come back tomorrow!</div>
        `;
    }
    
    loginPrompt.appendChild(card);
}

// Create button to view yesterday's results
async function createYesterdayResultsButton() {
    try {
        // Fetch past questions
        const response = await fetch('/api/past-questions');
        const pastQuestions = await response.json();
        
        // Filter to only questions where results are available (canAnswer = false)
        const questionsWithResults = pastQuestions.filter(q => !q.canAnswer);
        
        // Get the most recent question with available results
        if (questionsWithResults.length === 0) {
            // Show placeholder - results coming soon
            const card = document.createElement('div');
            card.className = 'yesterday-results-card';
            card.innerHTML = `
                <div class="yesterday-header">
                    <span class="yesterday-icon">📊</span>
                    <span class="yesterday-title">Yesterday's Results</span>
                </div>
                <div class="yesterday-question" style="color: #94a3b8;">Results coming soon</div>
                <div class="yesterday-date">Check back tomorrow!</div>
            `;
            return card;
        }
        
        const yesterdayQuestion = questionsWithResults[0];
        
        // Create the button card with clickable button
        const card = document.createElement('div');
        card.className = 'yesterday-results-card';
        card.innerHTML = `
            <div class="yesterday-header">
                <span class="yesterday-icon">📊</span>
                <span class="yesterday-title">Yesterday's Results</span>
            </div>
            <div class="yesterday-question">${yesterdayQuestion.question}</div>
            <div class="yesterday-date">${formatDate(yesterdayQuestion.date)}</div>
            <button class="view-yesterday-btn" id="viewYesterdayBtn">
                View Results
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </button>
        `;
        
        // Add click handler
        card.querySelector('#viewYesterdayBtn').addEventListener('click', async () => {
            // Immediately hide this card and show "loading" message
            const loginPrompt = document.getElementById('loginPrompt');
            if (loginPrompt) {
                loginPrompt.innerHTML = `
                    <div class="yesterday-results-card loading-card">
                        <div style="padding: 20px; text-align: center;">
                            <div style="font-size: 1.1rem; color: #667eea; font-weight: 600; margin-bottom: 10px;">
                                Loading results...
                            </div>
                            <div style="font-size: 0.9rem; color: #94a3b8;">
                                Watch the reveal animation above
                            </div>
                        </div>
                    </div>
                `;
            }
            
            isViewingFromYesterdayButton = true;
            yesterdayQuestionData = yesterdayQuestion;
            await loadPastQuestion(yesterdayQuestion, true); // Force animation = true
        });
        
        return card;
    } catch (error) {
        console.error('Error creating yesterday button:', error);
        return null;
    }
}

function startLockedCountdown() {
    const hoursEl = document.getElementById('lockedHours');
    const minutesEl = document.getElementById('lockedMinutes');
    const secondsEl = document.getElementById('lockedSeconds');
    
    if (!hoursEl || !minutesEl || !secondsEl) return;
    
    function updateCountdown() {
        const now = new Date();
        const options = { timeZone: 'America/New_York' };
        const etTime = new Date(now.toLocaleString('en-US', options));
        
        const tomorrow = new Date(etTime);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        const diff = tomorrow - etTime;
        
        if (diff <= 0) {
            hoursEl.textContent = '00';
            minutesEl.textContent = '00';
            secondsEl.textContent = '00';
            clearInterval(lockedCountdownInterval);
            return;
        }
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        hoursEl.textContent = String(hours).padStart(2, '0');
        minutesEl.textContent = String(minutes).padStart(2, '0');
        secondsEl.textContent = String(seconds).padStart(2, '0');
    }
    
    updateCountdown();
    lockedCountdownInterval = setInterval(updateCountdown, 1000);
}

// Share Button Handler (for results view header)
document.addEventListener('DOMContentLoaded', () => {
    const shareBtn = document.getElementById('shareButtonHeader');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            if (!currentQuestion) return;
            
            const shareData = {
                title: 'Predict the People',
                text: `${currentQuestion.question}\n\nWhat would YOU answer?`,
                url: window.location.href
            };
            
            try {
                if (navigator.share) {
                    await navigator.share(shareData);
                } else {
                    await navigator.clipboard.writeText(window.location.href);
                    alert('Link copied to clipboard!');
                }
            } catch (error) {
                console.log('Share cancelled or failed:', error);
            }
        });
    }
});
