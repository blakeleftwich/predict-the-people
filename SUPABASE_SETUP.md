# 🚀 Supabase Setup Guide for Wii Votes Channel

This guide will walk you through setting up Supabase authentication and using your existing database tables.

## ✅ Prerequisites

You already have:
- A Supabase project at: `https://rpthyjmtuczuuxgwoiqj.supabase.co`
- Your anon key configured in `supabaseClient.js`
- **Existing database tables and RLS policies** ✅

## 📋 Your Existing Database Schema

You already have these tables set up:

### 1. `poll_questions`
Stores daily questions
- `id` (uuid)
- `question_text` (text)
- `options` (text[] array)
- `published_at` (date)
- `results_unlock_date` (date)

### 2. `poll_answers`
Stores user answers
- `id` (uuid)
- `user_id` (uuid, FK to auth.users)
- `question_id` (uuid, FK to poll_questions)
- `answer` (text)
- `correct` (boolean)
- `created_at` (timestamp)

### 3. `user_stats`
Tracks user statistics
- `user_id` (uuid, PK)
- `points` (int)
- `wins` (int)
- `losses` (int)
- `current_win_streak` (int)
- `best_win_streak` (int)
- `daily_streak` (int)
- `best_daily_streak` (int)
- `last_answered_date` (date)
- `accuracy` (numeric)

**✅ Your RLS policies are already configured correctly!**

## 🔐 Step 1: Enable Email Authentication (If Not Already Done)

1. **Go to Authentication Settings**
   - In Supabase Dashboard, click "Authentication"
   - Click "Providers"

2. **Enable Email Provider**
   - Find "Email" in the provider list
   - Toggle it ON if not already enabled
   - Make sure "Enable Email Confirmations" is checked
   - Click "Save"

## 🌐 Step 2: Configure Site URL

1. **Set Site URL**
   - Go to "Authentication" → "URL Configuration"
   - Set Site URL to: `http://localhost:3000`
   - Add to Redirect URLs: `http://localhost:3000`
   - Click "Save"

2. **For Production (when you deploy)**
   - Update Site URL to your production domain
   - Add production domain to Redirect URLs

## 🧪 Step 3: Test the Setup

1. **Start your server**
   ```bash
   npm start
   ```

2. **Go to** `http://localhost:3000`

3. **Test Authentication**
   - Answer today's question
   - When you see "Sign in to Save Stats", click it
   - Enter your email
   - Check your email for the magic link
   - Click the link to sign in

4. **Verify Database**
   - After signing in, check Supabase Dashboard
   - Go to "Table Editor" → `user_stats`
   - You should see your user ID with initial stats

5. **Test Stats Page**
   - Click "📊 My Stats" button in the header
   - You should see your stats (will be 0 initially)
   - Answer some questions and check back!

## 🔄 How Stats Work

### When User Submits an Answer:
1. User selects an answer (e.g., "Coffee")
2. User guesses what majority chose (e.g., "Tea")
3. Answer is saved locally and to server
4. Results are locked for 3 days

### When Results Unlock (Day 3):
1. System calculates actual majority answer
2. Compares user's guess to actual majority
3. Updates `poll_answers` table with result (correct: true/false)
4. Updates `user_stats` table:
   - `wins++` (if correct) or `losses++` (if incorrect)
   - `points` += 10 (if correct)
   - `accuracy` = (wins / (wins + losses)) × 100
   - `current_win_streak` updated (increments on win, resets to 0 on loss)
   - `best_win_streak` updated if current exceeds it
   - `daily_streak` updated based on last answered date
   - `best_daily_streak` updated if current exceeds it

### Viewing Stats:
- Users can visit `/stats.html` anytime
- Shows:
  - Points earned (10 per correct guess)
  - Wins and Losses
  - Accuracy percentage
  - Current win streak
  - Best win streak (all-time)
  - Current daily streak
  - Best daily streak (all-time)

## 🔍 Troubleshooting

### Magic Link Not Arriving?
- Check your spam folder
- Verify email provider is enabled in Supabase
- Check Supabase Dashboard → Authentication → Users to see if user was created

### Stats Not Updating?
- Open browser console (F12) and check for errors
- Verify RLS policies are enabled in Supabase
- Make sure you're logged in when answering questions

### "Not authorized" errors?
- Check that RLS policies were created correctly
- Run the SQL schema again if needed
- Verify you're using the correct anon key

## 📊 Checking Your Database

### View Poll Questions:
```sql
SELECT * FROM poll_questions ORDER BY published_at DESC;
```

### View User Answers:
```sql
SELECT * FROM poll_answers ORDER BY created_at DESC;
```

### View User Stats:
```sql
SELECT * FROM user_stats;
```

### Check Specific User's Stats:
```sql
SELECT 
    u.email,
    s.points,
    s.wins,
    s.losses,
    s.accuracy,
    s.current_win_streak,
    s.best_win_streak,
    s.daily_streak,
    s.best_daily_streak,
    s.last_answered_date
FROM user_stats s
JOIN auth.users u ON s.user_id = u.id;
```

## 🎯 Next Steps

1. ✅ Your database tables are already set up!
2. ✅ Your RLS policies are already configured!
3. ✅ Enable email authentication (if not already done)
4. ✅ Configure Site URL
5. ✅ Test the login flow
6. ✅ Answer some questions and verify stats update
7. 🚀 Deploy to production when ready!

## 🆘 Support

If you run into issues:
1. Check the browser console for errors
2. Check Supabase logs in the Dashboard
3. Verify all tables and RLS policies exist
4. Make sure Site URL is configured correctly

---

**Your Wii Votes Channel is now powered by Supabase! 🎮✨**
