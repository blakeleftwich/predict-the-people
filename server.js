const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL || 'https://rpthyjmtuczuuxgwoiqj.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwdGh5am10dWN6dXV4Z3dvaXFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3MTMwMzAsImV4cCI6MjA3OTI4OTAzMH0.7CfgHulo_zdSkgXxwbaicajrQedce4pGh793pWyofcA';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwdGh5am10dWN6dXV4Z3dvaXFqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcxMzAzMCwiZXhwIjoyMDc5Mjg5MDMwfQ.i0kALJjBBeo1jr6uAKwKPy9GWV5Lc2OA1wLepKLLPts';

// Use service_role key for server-side queries (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Handle favicon.ico requests by serving favicon.svg
app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/favicon.svg');
});

// Data file paths
const QUESTIONS_FILE = path.join(__dirname, 'data', 'questions.json');
const VOTES_FILE = path.join(__dirname, 'data', 'votes.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Read config
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    // Create default config if it doesn't exist
    const defaultConfig = { adminPassword: 'admin123' };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
}

// Admin authentication middleware
function checkAdminAuth(req, res, next) {
  const config = readConfig();
  const providedPassword = req.headers['x-admin-password'] || req.body.password;
  
  if (providedPassword === config.adminPassword) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Initialize data files if they don't exist
function initializeData() {
  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
  }
  
  if (!fs.existsSync(QUESTIONS_FILE)) {
    const initialQuestions = [
      {
        id: "q1",
        date: getTodayDate(),
        question: "Are you a morning person or a night owl?",
        choices: ["Morning Person", "Night Owl"]
      },
      {
        id: "q2",
        date: getDateOffset(-1),
        question: "Which do you prefer?",
        choices: ["Coffee", "Tea", "Neither"]
      },
      {
        id: "q3",
        date: getDateOffset(-2),
        question: "What's your favorite season?",
        choices: ["Spring", "Summer", "Fall", "Winter"]
      },
      {
        id: "q4",
        date: getDateOffset(-3),
        question: "Do you prefer cats or dogs?",
        choices: ["Cats", "Dogs", "Both!", "Neither"]
      },
      {
        id: "q5",
        date: getDateOffset(-4),
        question: "Pizza or Burgers?",
        choices: ["Pizza", "Burgers"]
      }
    ];
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(initialQuestions, null, 2));
  }
  
  if (!fs.existsSync(VOTES_FILE)) {
    fs.writeFileSync(VOTES_FILE, JSON.stringify({}, null, 2));
  }
}

// Helper functions
function getTodayDate() {
  // Use Eastern Time (America/New_York) instead of UTC
  const today = new Date();
  const options = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' };
  const easternDateStr = today.toLocaleDateString('en-CA', options); // en-CA gives YYYY-MM-DD format
  return easternDateStr;
}

function getDateOffset(days) {
  const date = new Date();
  const options = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' };
  const easternDateStr = date.toLocaleDateString('en-CA', options);
  const easternDate = new Date(easternDateStr + 'T00:00:00');
  easternDate.setDate(easternDate.getDate() + days);
  return easternDate.toISOString().split('T')[0];
}

function readQuestions() {
  return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
}

function readVotes() {
  return JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8'));
}

function writeVotes(votes) {
  fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2));
}

// Calculate days since question publication
function getDaysSincePublication(questionDate) {
  const today = new Date(getTodayDate());
  const pubDate = new Date(questionDate);
  const diffTime = today - pubDate;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Get question status based on age
function getQuestionStatus(question) {
  const daysSince = getDaysSincePublication(question.date);
  
  return {
    ...question,
    daysSincePublication: daysSince,
    status: daysSince >= 1 ? 'locked' : 'active',
    canAnswer: daysSince < 1,
    canViewResults: daysSince >= 1,
    daysUntilResults: daysSince >= 1 ? 0 : 1 - daysSince
  };
}

// API Routes

// Get today's question
app.get('/api/today', async (req, res) => {
  try {
    const today = getTodayDate();
    
    // Fetch today's question from Supabase
    const { data, error } = await supabase
      .from('poll_questions')
      .select('*')
      .eq('published_at', today)
      .single();
    
    if (error) {
      console.error('Supabase error:', error);
      return res.status(404).json({ error: 'No question for today' });
    }
    
    if (data) {
      // Convert Supabase format to app format
      const question = {
        id: data.id,
        date: data.published_at,
        question: data.question_text,
        choices: data.options
      };
      
      res.json(getQuestionStatus(question));
    } else {
      res.status(404).json({ error: 'No question for today' });
    }
  } catch (error) {
    console.error('Error fetching today\'s question:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get a specific question by ID
app.get('/api/question/:id', async (req, res) => {
  try {
    // Fetch question from Supabase
    const { data, error } = await supabase
      .from('poll_questions')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (error || !data) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Convert Supabase format to app format
    const question = {
      id: data.id,
      date: data.published_at,
      question: data.question_text,
      choices: data.options
    };
    
    res.json(getQuestionStatus(question));
  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get last 5 questions
app.get('/api/past-questions', async (req, res) => {
  try {
    const today = getTodayDate();
    
    // Fetch past questions from Supabase (last 5, EXCLUDING today)
    const { data, error } = await supabase
      .from('poll_questions')
      .select('*')
      .lt('published_at', today)  // Changed from lte to lt - exclude today
      .order('published_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('Supabase error:', error);
      return res.json([]);
    }
    
    // Convert Supabase format to app format
    const pastQuestions = (data || []).map(q => {
      const question = {
        id: q.id,
        date: q.published_at,
        question: q.question_text,
        choices: q.options
      };
      return getQuestionStatus(question);
    });
    
    res.json(pastQuestions);
  } catch (error) {
    console.error('Error fetching past questions:', error);
    res.json([]);
  }
});

// Submit answer and majority guess
app.post('/api/vote', async (req, res) => {
  const { questionId, answer, majorityGuess } = req.body;
  
  if (!questionId || !answer || !majorityGuess) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    // Check if question exists in Supabase
    const { data, error } = await supabase
      .from('poll_questions')
      .select('*')
      .eq('id', questionId)
      .single();
    
    if (error || !data) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Convert to app format
    const question = {
      id: data.id,
      date: data.published_at,
      question: data.question_text,
      choices: data.options
    };
    
    const questionStatus = getQuestionStatus(question);
    
    if (!questionStatus.canAnswer) {
      return res.status(403).json({ 
        error: 'Question is locked',
        message: 'This question can no longer be answered (1-day window expired)'
      });
    }
    
    // Note: Vote counting is now handled by database (poll_answers table)
    // Anonymous votes are saved in cookies on client-side
    // Logged-in votes are saved to database by client-side code
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting vote:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get results for a question
app.get('/api/results/:id', async (req, res) => {
  try {
    // Fetch question from Supabase
    const { data, error } = await supabase
      .from('poll_questions')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (error || !data) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Convert to app format
    const question = {
      id: data.id,
      date: data.published_at,
      question: data.question_text,
      choices: data.options
    };
    
    const questionStatus = getQuestionStatus(question);
    
    // Check if results are available
    if (!questionStatus.canViewResults) {
      return res.json({
        question: question.question,
        date: question.date,
        locked: true,
        daysUntilResults: questionStatus.daysUntilResults,
        message: `Results will unlock in ${questionStatus.daysUntilResults} day${questionStatus.daysUntilResults === 1 ? '' : 's'}`
      });
    }
    
    // Count votes from Supabase poll_answers table
    const { data: answers, error: answersError } = await supabase
      .from('poll_answers')
      .select('answer')
      .eq('question_id', question.id);
    
    if (answersError) {
      console.error('Error fetching answers:', answersError);
      return res.status(500).json({ error: 'Error fetching votes' });
    }
    
    // Count answers
    const answerCounts = {};
    (answers || []).forEach(record => {
      const choice = record.answer;
      answerCounts[choice] = (answerCounts[choice] || 0) + 1;
    });
    
    // Calculate total votes
    const totalVotes = Object.values(answerCounts).reduce((sum, count) => sum + count, 0);
    
    // Calculate percentages
    const results = question.choices.map(choice => {
      const count = answerCounts[choice] || 0;
      const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      return {
        choice,
        percentage
      };
    });
    
    res.json({
      question: question.question,
      date: question.date,
      locked: false,
      results,
      totalVotes
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== ADMIN ROUTES ==========

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Verify admin password
app.post('/api/admin/verify', (req, res) => {
  const config = readConfig();
  const { password } = req.body;
  
  if (password === config.adminPassword) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Get all questions (admin)
app.get('/api/admin/questions', checkAdminAuth, async (req, res) => {
  try {
    const today = getTodayDate();
    
    // Fetch all questions from Supabase
    const { data, error } = await supabase
      .from('poll_questions')
      .select('*')
      .order('published_at', { ascending: false });
    
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to fetch questions' });
    }
    
    // Convert and add status to each question
    const questionsWithStatus = (data || []).map(q => {
      const question = {
        id: q.id,
        date: q.published_at,
        question: q.question_text,
        choices: q.options
      };
      
      const status = getQuestionStatus(question);
      const isToday = question.date === today;
      const isFuture = question.date > today;
      const isPast = question.date < today;
      
      return {
        ...status,
        isToday,
        isFuture,
        isPast
      };
    });
    
    res.json(questionsWithStatus);
  } catch (error) {
    console.error('Error fetching admin questions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add new question (admin)
app.post('/api/admin/questions', checkAdminAuth, (req, res) => {
  const { date, question, choices } = req.body;
  
  if (!date || !question || !choices || !Array.isArray(choices) || choices.length < 2 || choices.length > 4) {
    return res.status(400).json({ 
      error: 'Invalid input',
      message: 'Must provide date, question, and 2-4 choices'
    });
  }
  
  const questions = readQuestions();
  
  // Check if question already exists for this date
  if (questions.some(q => q.date === date)) {
    return res.status(400).json({ 
      error: 'Date conflict',
      message: 'A question already exists for this date'
    });
  }
  
  // Generate new ID
  const maxId = questions.reduce((max, q) => {
    const num = parseInt(q.id.replace('q', ''));
    return num > max ? num : max;
  }, 0);
  const newId = `q${maxId + 1}`;
  
  // Add new question
  questions.push({
    id: newId,
    date,
    question,
    choices
  });
  
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
  
  res.json({ success: true, id: newId });
});

// Update question (admin)
app.put('/api/admin/questions/:id', checkAdminAuth, (req, res) => {
  const { id } = req.params;
  const { date, question, choices } = req.body;
  
  if (!date || !question || !choices || !Array.isArray(choices) || choices.length < 2 || choices.length > 4) {
    return res.status(400).json({ 
      error: 'Invalid input',
      message: 'Must provide date, question, and 2-4 choices'
    });
  }
  
  const questions = readQuestions();
  const index = questions.findIndex(q => q.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Question not found' });
  }
  
  // Check if new date conflicts with another question
  if (questions.some(q => q.id !== id && q.date === date)) {
    return res.status(400).json({ 
      error: 'Date conflict',
      message: 'Another question already exists for this date'
    });
  }
  
  // Update question
  questions[index] = {
    id,
    date,
    question,
    choices
  };
  
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
  
  res.json({ success: true });
});

// Delete question (admin)
app.delete('/api/admin/questions/:id', checkAdminAuth, (req, res) => {
  const { id } = req.params;
  
  const questions = readQuestions();
  const filteredQuestions = questions.filter(q => q.id !== id);
  
  if (filteredQuestions.length === questions.length) {
    return res.status(404).json({ error: 'Question not found' });
  }
  
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(filteredQuestions, null, 2));
  
  // Also delete votes for this question
  const votes = readVotes();
  delete votes[id];
  writeVotes(votes);
  
  res.json({ success: true });
});

// Initialize data and start server
// initializeData(); // DISABLED for Vercel (read-only filesystem)

app.listen(PORT, () => {
  console.log(`
  📊 Predict the People is running!
  
  Open your browser and go to: http://localhost:${PORT}
  
  Press Ctrl+C to stop the server.
  `);
});
