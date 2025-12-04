import { supabase } from './supabaseClient.js';

// Global state
let adminPassword = '';
let currentFilter = 'all';
let allQuestions = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupLoginForm();
    setupAddQuestionForm();
    setupEditModal();
    setupFilterTabs();
});

// ===== LOGIN =====
function setupLoginForm() {
    const passwordInput = document.getElementById('passwordInput');
    const loginButton = document.getElementById('loginButton');
    const loginError = document.getElementById('loginError');

    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loginButton.click();
        }
    });

    loginButton.addEventListener('click', async () => {
        const password = passwordInput.value;
        
        if (!password) {
            showError(loginError, 'Please enter a password');
            return;
        }

        try {
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (response.ok) {
                adminPassword = password;
                document.getElementById('loginScreen').classList.add('hidden');
                document.getElementById('adminDashboard').classList.remove('hidden');
                loadQuestions();
            } else {
                showError(loginError, 'Invalid password');
            }
        } catch (error) {
            showError(loginError, 'Error connecting to server');
        }
    });

    // Logout
    document.getElementById('logoutButton').addEventListener('click', () => {
        adminPassword = '';
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('adminDashboard').classList.add('hidden');
        passwordInput.value = '';
    });
}

// ===== ADD QUESTION =====
function setupAddQuestionForm() {
    const form = document.getElementById('addQuestionForm');
    const addChoiceBtn = document.getElementById('addChoiceBtn');
    const removeChoiceBtn = document.getElementById('removeChoiceBtn');
    const choicesContainer = document.getElementById('choicesInputs');

    addChoiceBtn.addEventListener('click', () => {
        const currentChoices = choicesContainer.querySelectorAll('.choice-input').length;
        if (currentChoices < 4) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'choice-input';
            input.placeholder = `Choice ${currentChoices + 1}`;
            input.required = true;
            choicesContainer.appendChild(input);
        }
    });

    removeChoiceBtn.addEventListener('click', () => {
        const choices = choicesContainer.querySelectorAll('.choice-input');
        if (choices.length > 2) {
            choices[choices.length - 1].remove();
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('newDate').value;
        const question = document.getElementById('newQuestion').value;
        const imageUrl = document.getElementById('newImageUrl').value.trim();
        const choiceInputs = choicesContainer.querySelectorAll('.choice-input');
        const choices = Array.from(choiceInputs).map(input => input.value.trim()).filter(v => v);

        if (choices.length < 2) {
            showError(document.getElementById('addError'), 'Please provide at least 2 choices');
            return;
        }

        try {
            const response = await fetch('/api/admin/questions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': adminPassword
                },
                body: JSON.stringify({ date, question, choices, imageUrl: imageUrl || null })
            });

            const data = await response.json();

            if (response.ok) {
                showSuccess(document.getElementById('addSuccess'), 'Question added successfully!');
                
                // Sync to Supabase
                await syncQuestionToSupabase(data.id, question, choices, date, imageUrl || null);
                
                form.reset();
                loadQuestions();
                
                // Clear success message after 3 seconds
                setTimeout(() => {
                    document.getElementById('addSuccess').classList.add('hidden');
                }, 3000);
            } else {
                showError(document.getElementById('addError'), data.message || 'Error adding question');
            }
        } catch (error) {
            showError(document.getElementById('addError'), 'Error connecting to server');
        }
    });
}

// ===== LOAD QUESTIONS =====
async function loadQuestions() {
    const listContainer = document.getElementById('questionsList');
    listContainer.innerHTML = '<p class="loading">Loading questions...</p>';

    try {
        const response = await fetch('/api/admin/questions', {
            headers: { 'X-Admin-Password': adminPassword }
        });

        if (!response.ok) throw new Error('Failed to load');

        allQuestions = await response.json();
        displayQuestions();
    } catch (error) {
        listContainer.innerHTML = '<p class="error-message">Error loading questions</p>';
    }
}

function displayQuestions() {
    const listContainer = document.getElementById('questionsList');
    listContainer.innerHTML = '';

    if (allQuestions.length === 0) {
        listContainer.innerHTML = '<p class="loading">No questions yet. Add one above!</p>';
        return;
    }

    allQuestions.forEach(question => {
        const item = document.createElement('div');
        item.className = 'question-item';
        item.dataset.filter = question.isFuture ? 'future' : question.isToday ? 'today' : 'past';

        let dateClass = 'date-past';
        let dateLabel = 'Past';
        if (question.isFuture) {
            dateClass = 'date-future';
            dateLabel = 'Future';
        } else if (question.isToday) {
            dateClass = 'date-today';
            dateLabel = 'Today';
        }

        const choicesTags = question.choices.map(c => 
            `<span class="choice-tag">${c}</span>`
        ).join('');

        const statusText = question.canAnswer 
            ? `Answerable (Day ${question.daysSincePublication})` 
            : `Locked - Results available`;

        item.innerHTML = `
            <div class="question-header">
                <div class="question-date ${dateClass}">${dateLabel} - ${formatDate(question.date)}</div>
            </div>
            <div class="question-text">${question.question}</div>
            <div class="question-choices">${choicesTags}</div>
            <div class="question-status">${statusText}</div>
            <div class="question-actions">
                <button class="btn-edit" data-question-id="${question.id}">Edit</button>
                <button class="btn-delete" data-question-id="${question.id}" data-question-text="${escapeHtml(question.question)}">Delete</button>
            </div>
        `;

        // Add event listeners after creating the element
        const editBtn = item.querySelector('.btn-edit');
        const deleteBtn = item.querySelector('.btn-delete');
        
        editBtn.addEventListener('click', () => editQuestion(question.id));
        deleteBtn.addEventListener('click', () => deleteQuestion(question.id, question.question));

        listContainer.appendChild(item);
    });

    applyFilter();
}

// ===== FILTER =====
function setupFilterTabs() {
    const tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            applyFilter();
        });
    });
}

function applyFilter() {
    const items = document.querySelectorAll('.question-item');
    items.forEach(item => {
        if (currentFilter === 'all' || item.dataset.filter === currentFilter) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

// ===== EDIT QUESTION =====
function setupEditModal() {
    const modal = document.getElementById('editModal');
    const closeBtn = modal.querySelector('.close-modal');
    const cancelBtn = modal.querySelector('.cancel-edit');
    const form = document.getElementById('editQuestionForm');

    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    cancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('editId').value;
        const date = document.getElementById('editDate').value;
        const question = document.getElementById('editQuestion').value;
        const imageUrl = document.getElementById('editImageUrl').value.trim();
        const choiceInputs = document.querySelectorAll('#editChoicesInputs .choice-input');
        const choices = Array.from(choiceInputs).map(input => input.value.trim()).filter(v => v);

        if (choices.length < 2) {
            showError(document.getElementById('editError'), 'Please provide at least 2 choices');
            return;
        }

        try {
            const response = await fetch(`/api/admin/questions/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': adminPassword
                },
                body: JSON.stringify({ date, question, choices, imageUrl: imageUrl || null })
            });

            const data = await response.json();

            if (response.ok) {
                // Sync update to Supabase
                await syncQuestionToSupabase(id, question, choices, date, imageUrl || null);
                
                modal.classList.add('hidden');
                loadQuestions();
            } else {
                showError(document.getElementById('editError'), data.message || 'Error updating question');
            }
        } catch (error) {
            showError(document.getElementById('editError'), 'Error connecting to server');
        }
    });
}

function editQuestion(id) {
    const question = allQuestions.find(q => q.id === id);
    if (!question) return;

    document.getElementById('editId').value = question.id;
    document.getElementById('editDate').value = question.date;
    document.getElementById('editQuestion').value = question.question;
    document.getElementById('editImageUrl').value = question.imageUrl || '';

    const choicesContainer = document.getElementById('editChoicesInputs');
    choicesContainer.innerHTML = '';
    
    question.choices.forEach((choice, index) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'choice-input';
        input.value = choice;
        input.placeholder = `Choice ${index + 1}`;
        input.required = true;
        choicesContainer.appendChild(input);
    });

    document.getElementById('editError').classList.add('hidden');
    document.getElementById('editModal').classList.remove('hidden');
}

// ===== DELETE QUESTION =====
async function deleteQuestion(id, questionText) {
    if (!confirm(`Are you sure you want to delete this question?\n\n"${questionText}"\n\nThis will also delete all votes for this question.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/questions/${id}`, {
            method: 'DELETE',
            headers: { 'X-Admin-Password': adminPassword }
        });

        if (response.ok) {
            // Delete from Supabase too
            await deleteQuestionFromSupabase(id);
            
            loadQuestions();
        } else {
            alert('Error deleting question');
        }
    } catch (error) {
        alert('Error connecting to server');
    }
}

// ===== UTILITIES =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
}

function showSuccess(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
}

function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// ===== SUPABASE SYNC =====
async function syncQuestionToSupabase(questionId, questionText, choices, publishDate, imageUrl = null) {
    try {
        // Calculate results unlock date (3 days after publish)
        const publishDateObj = new Date(publishDate);
        const unlockDateObj = new Date(publishDateObj);
        unlockDateObj.setDate(unlockDateObj.getDate() + 3);
        const resultsUnlockDate = unlockDateObj.toISOString().split('T')[0];
        
        // Check if question already exists in Supabase
        const { data: existing } = await supabase
            .from('poll_questions')
            .select('id')
            .eq('id', questionId)
            .maybeSingle();
        
        if (!existing) {
            // Insert new question to Supabase
            const { error } = await supabase
                .from('poll_questions')
                .insert({
                    id: questionId,
                    question_text: questionText,
                    options: choices,
                    published_at: publishDate,
                    results_unlock_date: resultsUnlockDate,
                    image_url: imageUrl
                });
            
            if (error) {
                console.error('Error syncing to Supabase:', error);
            } else {
                console.log('✅ Question synced to Supabase');
            }
        } else {
            // Update existing question
            const { error } = await supabase
                .from('poll_questions')
                .update({
                    question_text: questionText,
                    options: choices,
                    published_at: publishDate,
                    results_unlock_date: resultsUnlockDate,
                    image_url: imageUrl
                })
                .eq('id', questionId);
            
            if (error) {
                console.error('Error updating Supabase:', error);
            } else {
                console.log('✅ Question updated in Supabase');
            }
        }
    } catch (error) {
        console.error('Error syncing question to Supabase:', error);
    }
}

async function deleteQuestionFromSupabase(questionId) {
    try {
        const { error } = await supabase
            .from('poll_questions')
            .delete()
            .eq('id', questionId);
        
        if (error) {
            console.error('Error deleting from Supabase:', error);
        } else {
            console.log('✅ Question deleted from Supabase');
        }
    } catch (error) {
        console.error('Error deleting question from Supabase:', error);
    }
}
