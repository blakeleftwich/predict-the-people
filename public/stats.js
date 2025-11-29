import { supabase } from './supabaseClient.js';
import { getCurrentUser, isLoggedIn } from './auth.js';

// Save poll response and update stats
export async function savePollResponse(pollId, chosenOption, majorityGuess, actualMajority) {
    if (!isLoggedIn()) {
        return; // Don't save if not logged in
    }
    
    const user = getCurrentUser();
    const isCorrect = majorityGuess === actualMajority;
    
    try {
        // Check if answer already exists
        const { data: existingAnswer } = await supabase
            .from('poll_answers')
            .select('id')
            .eq('user_id', user.id)
            .eq('question_id', pollId)
            .single();
        
        if (existingAnswer) {
            // Update existing answer with correct/incorrect status
            await supabase
                .from('poll_answers')
                .update({
                    answer: chosenOption,
                    correct: isCorrect
                })
                .eq('id', existingAnswer.id);
        } else {
            // Insert new answer
            await supabase
                .from('poll_answers')
                .insert({
                    question_id: pollId,
                    user_id: user.id,
                    answer: chosenOption,
                    correct: isCorrect
                });
        }
        
        // Update user stats
        await updateUserStats(user.id, isCorrect);
        
    } catch (error) {
        console.error('Error saving poll response:', error);
    }
}

// Update user stats after a guess
async function updateUserStats(userId, isCorrect) {
    try {
        // Get current stats
        const { data: stats, error: fetchError } = await supabase
            .from('user_stats')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') {
            // PGRST116 means no rows found, which is okay
            throw fetchError;
        }
        
        // Calculate new values
        const currentWins = (stats?.wins || 0);
        const currentLosses = (stats?.losses || 0);
        const totalGuesses = currentWins + currentLosses + 1;
        const newWins = currentWins + (isCorrect ? 1 : 0);
        const newLosses = currentLosses + (isCorrect ? 0 : 1);
        const accuracy = (newWins / totalGuesses) * 100;
        const points = (stats?.points || 0) + (isCorrect ? 10 : 0); // 10 points per correct guess
        
        // Calculate streaks
        const today = new Date().toISOString().split('T')[0];
        const lastAnsweredDate = stats?.last_answered_date;
        let dailyStreak = stats?.daily_streak || 0;
        let currentWinStreak = stats?.current_win_streak || 0;
        
        // Daily streak logic
        if (lastAnsweredDate) {
            const lastDate = new Date(lastAnsweredDate);
            const todayDate = new Date(today);
            const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                // Same day, no change to daily streak
            } else if (diffDays === 1) {
                // Yesterday, increment daily streak
                dailyStreak++;
            } else {
                // Streak broken, reset to 1
                dailyStreak = 1;
            }
        } else {
            // First time playing
            dailyStreak = 1;
        }
        
        // Win streak logic
        if (isCorrect) {
            currentWinStreak++;
        } else {
            currentWinStreak = 0;
        }
        
        const bestWinStreak = Math.max(stats?.best_win_streak || 0, currentWinStreak);
        const bestDailyStreak = Math.max(stats?.best_daily_streak || 0, dailyStreak);
        
        // Upsert stats
        if (stats) {
            // Update existing stats
            const { error: updateError } = await supabase
                .from('user_stats')
                .update({
                    points: points,
                    wins: newWins,
                    losses: newLosses,
                    accuracy: accuracy,
                    current_win_streak: currentWinStreak,
                    best_win_streak: bestWinStreak,
                    daily_streak: dailyStreak,
                    best_daily_streak: bestDailyStreak,
                    last_answered_date: today
                })
                .eq('user_id', userId);
            
            if (updateError) throw updateError;
        } else {
            // Insert new stats
            const { error: insertError } = await supabase
                .from('user_stats')
                .insert({
                    user_id: userId,
                    points: points,
                    wins: newWins,
                    losses: newLosses,
                    accuracy: accuracy,
                    current_win_streak: currentWinStreak,
                    best_win_streak: bestWinStreak,
                    daily_streak: dailyStreak,
                    best_daily_streak: bestDailyStreak,
                    last_answered_date: today
                });
            
            if (insertError) throw insertError;
        }
        
    } catch (error) {
        console.error('Error updating user stats:', error);
    }
}

// Get user stats
export async function getUserStats(userId) {
    try {
        const { data, error } = await supabase
            .from('user_stats')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            throw error;
        }
        
        return data;
        
    } catch (error) {
        console.error('Error fetching user stats:', error);
        return null;
    }
}

// Sync poll to database (called by admin when adding questions)
export async function syncPollToDatabase(questionId, questionText, choices, publishDate) {
    try {
        // Calculate results unlock date (3 days after publish)
        const publishDateObj = new Date(publishDate);
        const unlockDateObj = new Date(publishDateObj);
        unlockDateObj.setDate(unlockDateObj.getDate() + 3);
        const resultsUnlockDate = unlockDateObj.toISOString().split('T')[0];
        
        // Check if poll already exists
        const { data: existingPoll } = await supabase
            .from('poll_questions')
            .select('id')
            .eq('id', questionId)
            .single();
        
        if (!existingPoll) {
            // Insert new poll
            await supabase
                .from('poll_questions')
                .insert({
                    id: questionId,
                    question_text: questionText,
                    options: choices,
                    published_at: publishDate,
                    results_unlock_date: resultsUnlockDate
                });
        }
    } catch (error) {
        console.error('Error syncing poll to database:', error);
    }
}

// Get poll from database
export async function getPollFromDatabase(pollId) {
    try {
        const { data, error } = await supabase
            .from('poll_questions')
            .select('*')
            .eq('id', pollId)
            .single();
        
        if (error) throw error;
        
        return data;
        
    } catch (error) {
        console.error('Error fetching poll:', error);
        return null;
    }
}
