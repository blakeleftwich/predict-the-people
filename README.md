# 🎮 Wii Votes Channel

A simple daily voting website inspired by the Wii Votes Channel! Users answer one daily question, guess what most people answered, and can catch up on past questions.

## Features

✅ Daily question voting system  
✅ Guess-the-majority game mechanic  
✅ 3-day answer window (questions lock after 3 days)
✅ Delayed results (results unlock after 3 days)
✅ Results displayed as percentages  
✅ Access to last 5 questions  
✅ Cookie-based tracking (no login required)  
✅ **🔐 Magic Link Authentication (via Supabase)**
✅ **📊 Persistent User Stats & Analytics**
✅ **🔥 Daily Streak Tracking**
✅ **🎯 Accuracy Percentage**
✅ **Password-protected admin panel**
✅ Add/edit/delete questions from web interface
✅ Schedule questions for future dates
✅ Mobile-responsive design  
✅ Clean, Wii-inspired UI  

## Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation & Running Locally

1. **Extract the ZIP file** to a folder on your computer

2. **Open a terminal/command prompt** in the project folder

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

5. **Open your browser** and go to:
   ```
   http://localhost:3000
   ```

That's it! The site is now running locally.

### Accessing the Admin Panel

1. **Go to the admin URL:**
   ```
   http://localhost:3000/admin
   ```

2. **Login with the default password:**
   ```
   admin123
   ```

3. **Change the password** (recommended):
   - Open `config.json` in the project folder
   - Change the `adminPassword` value
   - Save the file
   - Restart the server

**IMPORTANT:** The admin panel is password-protected but not linked anywhere on the public site. Keep your password secure!

## How It Works

### User Flow
1. User visits the site and sees today's question
2. User selects an answer and clicks "Submit Answer"
3. User is asked to guess what most people answered
4. User sees results as percentages
5. User can scroll down to answer past questions they missed

### Cookie System
- When a user answers a question, a cookie is set to remember they answered it
- Cookies last for 1 year
- No personal data is stored, just question IDs

### Data Storage
- Questions are stored in `data/questions.json`
- Vote data is stored in `data/votes.json`
- Both files are created automatically when you first run the server

## Managing Questions

### Using the Admin Panel (Recommended)

The easiest way to manage questions is through the web-based admin panel:

1. **Access the panel:** Go to `http://localhost:3000/admin`
2. **Login** with your password (default: `admin123`)
3. **Add questions** using the form:
   - Select a date
   - Enter your question
   - Add 2-4 answer choices
   - Click "Add Question"
4. **View all questions** with filters (All, Future, Today, Past)
5. **Edit or delete** questions as needed

### Manually Editing Questions (Alternative)

If you prefer, you can manually edit `data/questions.json`:

1. **Stop the server** (press Ctrl+C in the terminal)

2. **Open** `data/questions.json`

3. **Add a new question** following this format:
   ```json
   {
     "id": "q6",
     "date": "2025-11-21",
     "question": "Your question text here?",
     "choices": ["Option 1", "Option 2", "Option 3"]
   }
   ```

   **Important:**
   - `id`: Must be unique (e.g., q6, q7, q8...)
   - `date`: Format YYYY-MM-DD (use future dates for upcoming questions)
   - `question`: Your question text
   - `choices`: Array of 2-4 answer options

4. **Save the file** and **restart the server**

### Question Lifecycle

- **Day 0-2:** Question is answerable
- **Day 3+:** Question locks, results become visible
- Users can only answer questions within the 3-day window
- Results are delayed until Day 3 to build suspense!

## Project Structure

```
wii-votes/
├── server.js              # Express server & API endpoints
├── package.json           # Dependencies
├── config.json            # Admin password (DO NOT share!)
├── data/                  # Data storage (auto-created)
│   ├── questions.json     # Questions database
│   └── votes.json         # Vote tallies
├── public/                # Frontend files
│   ├── index.html         # Main HTML
│   ├── styles.css         # Public site styling
│   ├── app.js             # Public site logic
│   ├── admin.html         # Admin panel HTML
│   ├── admin-styles.css   # Admin panel styling
│   └── admin.js           # Admin panel logic
└── README.md              # This file
```

## Deployment Options

### Option 1: Vercel (Recommended - Easy & Free)

1. Create a free account at [vercel.com](https://vercel.com)

2. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```

3. In your project folder, run:
   ```bash
   vercel
   ```

4. Follow the prompts (just press Enter for defaults)

5. Your site will be live! Vercel gives you a URL like: `your-project.vercel.app`

**Note:** Add a `vercel.json` file for proper deployment:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/server.js"
    },
    {
      "src": "/(.*)",
      "dest": "/public/$1"
    }
  ]
}
```

### Option 2: Render (Also Free)

1. Create account at [render.com](https://render.com)
2. Create a new "Web Service"
3. Connect your GitHub repo (or upload files)
4. Use these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Deploy!

### Option 3: Railway

1. Create account at [railway.app](https://railway.app)
2. Create new project
3. Deploy from GitHub or upload folder
4. Railway auto-detects Node.js and deploys

### Option 4: DigitalOcean App Platform

1. Create account at [digitalocean.com](https://digitalocean.com)
2. Go to App Platform
3. Create app from GitHub or upload
4. Select Basic ($5/month tier)
5. Deploy!

## Customization

### Changing Colors
Edit `public/styles.css` and look for these color variables:
- `#667eea` - Primary purple
- `#764ba2` - Secondary purple
- `#f5f7fa` - Light background

### Changing Question Limit
In `server.js`, find this line:
```javascript
.slice(0, 5)
```
Change `5` to however many past questions you want to show.

### Changing Port
In `server.js`, change:
```javascript
const PORT = 3000;
```

## Troubleshooting

**Problem:** "Cannot find module 'express'"  
**Solution:** Run `npm install` in the project folder

**Problem:** "Port 3000 is already in use"  
**Solution:** Change the PORT number in `server.js` or stop other programs using port 3000

**Problem:** Questions aren't showing up  
**Solution:** Check that `data/questions.json` has a question with today's date

**Problem:** Votes aren't saving  
**Solution:** Make sure the `data/` folder exists and is writable

## Future Enhancements (V2 Ideas)

- User accounts with profiles
- Global/regional results comparison
- Question of the week
- Achievement/badge system
- Admin panel for managing questions
- Email notifications for daily questions
- Social sharing of results
- Historical trending data

## 🔐 Supabase Authentication & Stats

This site includes **magic link authentication** powered by Supabase for persistent user stats!

### Quick Setup:

1. **Run the Supabase SQL Schema**
   - See detailed instructions in `SUPABASE_SETUP.md`
   - Create the required tables: `polls`, `poll_responses`, `user_stats`

2. **Enable Email Authentication**
   - Go to your Supabase Dashboard
   - Enable Email provider in Authentication settings

3. **Configure Site URL**
   - Set to `http://localhost:3000` for development
   - Update for production when deploying

4. **Test It Out**
   - Click "Sign in to Save Stats" on the site
   - Enter your email
   - Check your email for the magic link
   - Click the link to sign in!

### What Stats Are Tracked:

- **Total Guesses**: Number of predictions you've made
- **Correct Guesses**: How many you got right
- **Accuracy**: Your success percentage
- **Daily Streak**: Consecutive days playing

View your stats anytime at `/stats.html` or click "📊 My Stats" when logged in!

**For complete setup instructions, see: [SUPABASE_SETUP.md](SUPABASE_SETUP.md)**

## Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript ES6 Modules
- **Backend:** Node.js, Express
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth (Magic Links)
- **Local Storage:** JSON files + Cookies
- **Session Management:** Cookies + Supabase Sessions

## License

MIT License - Feel free to modify and use however you like!

## Support

If you run into any issues, check:
1. Node.js is installed: `node --version`
2. All files extracted properly
3. Terminal is in the correct folder
4. Port 3000 is available

---

Made with 💜 inspired by the Wii Votes Channel
