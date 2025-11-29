# 🚀 QUICK START GUIDE

## Get Up and Running in 3 Minutes!

### Step 1: Extract & Install (2 min)
```bash
# Extract the ZIP
unzip wii-votes-with-supabase.zip
cd wii-votes

# Install dependencies
npm install
```

### Step 2: Enable Email Auth (30 sec)
1. Go to https://supabase.com/dashboard
2. Open your project: `rpthyjmtuczuuxgwoiqj`
3. Go to "Authentication" → "Providers"
4. Enable "Email" if not already enabled
5. Save

### Step 3: Configure URLs (30 sec)
1. In Supabase: "Authentication" → "URL Configuration"
2. Set Site URL: `http://localhost:3000`
3. Add to Redirect URLs: `http://localhost:3000`
4. Save

### Step 4: Start & Test! (30 sec)
```bash
npm start
```

Go to: `http://localhost:3000`

---

## ✅ Your Database is Already Set Up!

You already have these tables configured:
- ✅ `poll_questions` - Stores daily questions
- ✅ `poll_answers` - User answers & results
- ✅ `user_stats` - Points, streaks, accuracy
- ✅ RLS Policies - Security configured

**No SQL to run!** Your database is ready to go.

---

## 🧪 Test the Magic Link Flow

1. Answer today's question
2. Click "Sign in to Save Stats"
3. Enter your email
4. Check your email inbox
5. Click the magic link
6. You're logged in! ✅

---

## 📊 View Your Stats

Click "📊 My Stats" in the header (only visible when logged in)

---

## 🔧 Admin Panel

Go to: `http://localhost:3000/admin`
Password: `admin123` (change in `config.json`)

---

## 📚 Need More Help?

- **Complete Setup:** See `SUPABASE_SETUP.md`
- **What Changed:** See `INTEGRATION_SUMMARY.md`
- **General Info:** See `README.md`

---

**That's it! You're ready to go! 🎮✨**
