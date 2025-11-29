import { initAuth, setupLoginForm, getCurrentUser, isLoggedIn } from './auth.js';
import { savePollResponse, syncPollToDatabase } from './stats.js';
import { supabase } from './supabaseClient.js';

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
        
        // Check if question is locked (1+ days old)
        if (!todayQuestion.canAnswer) {
            // Question is locked, show results
            await showResults(todayQuestion.id);
            await loadPastQuestions();
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
async function showResults(questionId) {
    try {
        const response = await fetch(`/api/results/${questionId}`);
        const data = await response.json();
        
        document.getElementById('resultsQuestion').textContent = data.question;
        
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
                // Only show prediction if it exists (not null/undefined)
                if (userAnswerPrediction.prediction) {
                    subtitleElement.innerHTML = `You chose <em>${userAnswerPrediction.answer}</em> • You predicted <em>${userAnswerPrediction.prediction}</em>`;
                } else {
                    // Show only answer if prediction is missing
                    subtitleElement.innerHTML = `You chose <em>${userAnswerPrediction.answer}</em>`;
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
                <div class="unlock-pill">
                    <svg class="pill-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <span>Results ready tomorrow</span>
                </div>
                
                <div class="locked-countdown">
                    <div class="countdown-box">
                        <div class="countdown-number" id="lockedHours">--</div>
                        <div class="countdown-label-small">HOURS</div>
                    </div>
                    <div class="countdown-separator">:</div>
                    <div class="countdown-box">
                        <div class="countdown-number" id="lockedMinutes">--</div>
                        <div class="countdown-label-small">MINS</div>
                    </div>
                    <div class="countdown-separator">:</div>
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
            
            // Create separate feedback card
            const feedbackCard = document.createElement('div');
            feedbackCard.className = 'feedback-card';
            feedbackCard.innerHTML = `
                <p class="feedback-question">What did you think of this question?</p>
                <div class="locked-feedback-buttons">
                    <button class="soft-feedback-btn loved-btn" id="lovedBtn">
                        <span class="feedback-emoji">👍</span>
                        <span class="feedback-text">Loved it</span>
                    </button>
                    <button class="soft-feedback-btn not-for-me-btn" id="notForMeBtn">
                        <span class="feedback-emoji">👎</span>
                        <span class="feedback-text">Not for me</span>
                    </button>
                </div>
            `;
            resultsContainer.appendChild(feedbackCard);
            
            showView('resultsView');
            
            // Start locked countdown
            startLockedCountdown();
            
            // Setup feedback buttons
            setupLockedFeedback(currentQuestion.id);
        } else {
            // Check if user has seen these results before
            const alreadyViewed = hasViewedResults(questionId);
            
            if (!alreadyViewed && userAnswerPrediction) {
                // FIRST TIME viewing results - show dramatic reveal animation
                await playRevealAnimation(questionId, data, userAnswerPrediction);
                markResultsAsViewed(questionId);
            } else {
                // Already viewed OR no user data - show results instantly
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
    
    // Phase 1: Show "You chose..." at 2s (changed from 3s)
    console.log('🎬 REVEAL DEBUG - userAnswerGuess:', userAnswerGuess);
    
    if (userAnswerGuess) {
        console.log('🎬 REVEAL DEBUG - Waiting 2s before showing "You chose"');
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('🎬 REVEAL DEBUG - Showing "You chose":', userAnswerGuess.answer);
        choiceLine.innerHTML = `You chose <strong>${userAnswerGuess.answer}</strong>`;
        choiceLine.style.animation = 'revealChoiceIn 420ms ease-out forwards';
        
        // Phase 1b: Show "You predicted..." after 2s
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('🎬 REVEAL DEBUG - Showing "You predicted":', userAnswerGuess.prediction);
        choiceLine.style.animation = 'none';
        await new Promise(resolve => setTimeout(resolve, 10)); // Force reflow
        choiceLine.innerHTML = `You predicted <strong>${userAnswerGuess.prediction}</strong>`;
        choiceLine.style.animation = 'revealChoiceIn 420ms ease-out forwards';
        
        // Let "You predicted" stay for 2 seconds before fading
        await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
        console.log('🎬 REVEAL DEBUG - No userAnswerGuess data, showing generic reveal');
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
    
    // Phase 3: Scramble numbers super fast for 2 seconds (changed from 3s)
    const percentEls = Array.from(document.querySelectorAll('.result-percentage'));
    const scrambleStart = performance.now();
    const scrambleDuration = 2000;
    
    const scrambleInterval = setInterval(() => {
        const elapsed = performance.now() - scrambleStart;
        if (elapsed >= scrambleDuration) {
            clearInterval(scrambleInterval);
            // Reset to 0% before counting up
            percentEls.forEach(el => el.textContent = '0%');
            
            // Phase 4: Count up numbers in sync with bars
            setTimeout(() => {
                animateBarsAndNumbers(sortedResults);
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
        }
    }
    
    animate();
}

// Easing function
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Load Past Questions
async function loadPastQuestions() {
    try {
        const response = await fetch('/api/past-questions');
        const pastQuestions = await response.json();
        
        // Update both containers (standalone view and results view)
        const listContainer = document.getElementById('pastQuestionsList');
        const listContainerResults = document.getElementById('pastQuestionsListResults');
        
        listContainer.innerHTML = '';
        listContainerResults.innerHTML = '';
        
        if (pastQuestions.length === 0) {
            const emptyMessage = '<p style="text-align: center; color: #999;">No past questions yet. Check back tomorrow!</p>';
            listContainer.innerHTML = emptyMessage;
            listContainerResults.innerHTML = emptyMessage;
        } else {
            // Process all questions and check answered status
            for (const question of pastQuestions) {
                // Create item for standalone view
                const item = await createPastQuestionItem(question);
                listContainer.appendChild(item);
                
                // Create item for results view
                const itemResults = await createPastQuestionItem(question);
                listContainerResults.appendChild(itemResults);
            }
        }
        
        // Note: We don't show the standalone view here anymore
        // It will only be shown when explicitly needed
        
    } catch (error) {
        console.error('Error loading past questions:', error);
    }
}

// Helper function to create past question item
async function createPastQuestionItem(question) {
    const item = document.createElement('div');
    item.className = 'past-question-item';
    
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
                prediction: cookieData.prediction || cookieData.guess // Support both new and old cookie format
            };
        }
    }
    
    // Create choice/prediction text if available
    // Show if user answered (either within 1-day window OR if results are unlocked)
    let choicePredictionText = '';
    if (userAnswerPrediction && (isAnswered || !question.canAnswer)) {
        // Only show prediction if it exists (not null/undefined)
        if (userAnswerPrediction.prediction) {
            choicePredictionText = `
                <div class="past-question-choice-guess">
                    You chose <em>${userAnswerPrediction.answer}</em> • You predicted <em>${userAnswerPrediction.prediction}</em>
                </div>
            `;
        } else {
            // Show only answer if prediction is missing
            choicePredictionText = `
                <div class="past-question-choice-guess">
                    You chose <em>${userAnswerPrediction.answer}</em>
                </div>
            `;
        }
    }
    
    // Determine status text
    let statusText = '';
    if (question.canAnswer) {
        // Within 1-day window
        if (isAnswered) {
            statusText = '<div class="past-question-answered">✓ Answered - Results pending</div>';
        } else {
            statusText = '<div class="past-question-status">📝 Answer now!</div>';
        }
    } else {
        // Locked (1+ days old)
        statusText = '<div class="past-question-results">📊 View results</div>';
    }
    
    item.innerHTML = `
        <div class="past-question-date">${formatDate(question.date)}</div>
        <div class="past-question-text">${question.question}</div>
        ${choicePredictionText}
        ${statusText}
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
async function loadPastQuestion(question) {
    currentQuestion = question;
    
    // If question is locked (1+ days old), always show results
    if (!question.canAnswer) {
        await showResults(question.id);
        // Scroll to top to see results
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    
    // Check if already answered (check DB if logged in)
    if (await hasAnsweredQuestionInDB(question.id)) {
        await showResults(question.id);
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

// Locked Results Feedback
function setupLockedFeedback(questionId) {
    const lovedBtn = document.getElementById('lovedBtn');
    const notForMeBtn = document.getElementById('notForMeBtn');
    
    if (!lovedBtn || !notForMeBtn) return;
    
    // Load existing feedback
    const feedbackData = getCookie('question_feedback');
    if (feedbackData) {
        const feedbackObj = JSON.parse(feedbackData);
        const feedback = feedbackObj[questionId];
        
        if (feedback === 'loved') {
            lovedBtn.classList.add('active');
        } else if (feedback === 'not-for-me') {
            notForMeBtn.classList.add('active');
        }
    }
    
    // Add event listeners
    lovedBtn.addEventListener('click', () => handleLockedFeedback(questionId, 'loved'));
    notForMeBtn.addEventListener('click', () => handleLockedFeedback(questionId, 'not-for-me'));
}

function handleLockedFeedback(questionId, feedback) {
    const lovedBtn = document.getElementById('lovedBtn');
    const notForMeBtn = document.getElementById('notForMeBtn');
    
    if (!lovedBtn || !notForMeBtn) return;
    
    const feedbackData = getCookie('question_feedback');
    const feedbackObj = feedbackData ? JSON.parse(feedbackData) : {};
    const currentFeedback = feedbackObj[questionId];
    
    // Toggle if same button
    if (currentFeedback === feedback) {
        lovedBtn.classList.remove('active');
        notForMeBtn.classList.remove('active');
        delete feedbackObj[questionId];
    } else {
        lovedBtn.classList.remove('active');
        notForMeBtn.classList.remove('active');
        
        if (feedback === 'loved') {
            lovedBtn.classList.add('active');
        } else {
            notForMeBtn.classList.add('active');
        }
        
        feedbackObj[questionId] = feedback;
    }
    
    setCookie('question_feedback', JSON.stringify(feedbackObj), 365);
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
