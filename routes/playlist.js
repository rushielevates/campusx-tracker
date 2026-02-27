const express = require('express');
const router = express.Router();
const Playlist = require('../models/Playlist');
const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const CAMPUSX_PLAYLIST_ID = 'PLKnIA16_Rmvbr7zKYQuBfsVkjoLcJgxHH';

// Middleware to check auth
const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

// ===== TEST ROUTES =====
router.get('/test', (req, res) => {
    res.json({ 
        message: '✅ Playlist router is working!',
        hasYouTubeKey: !!YOUTUBE_API_KEY,
        youtubeKeyPrefix: YOUTUBE_API_KEY ? YOUTUBE_API_KEY.substring(0, 8) + '...' : 'not set',
        timestamp: new Date().toISOString()
    });
});

router.post('/import-test', auth, async (req, res) => {
    try {
        console.log('Import test hit by user:', req.session.userId);
        res.json({ 
            message: '✅ Import test route is accessible!',
            userId: req.session.userId,
            hasYouTubeKey: !!YOUTUBE_API_KEY
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ===== END TEST ROUTES =====

// ===== MAIN IMPORT ROUTE WITH DEBUG LOGGING =====
router.post('/import', auth, async (req, res) => {
    try {
        console.log('\n🚀 ========== IMPORT STARTED ==========');
        console.log('User ID:', req.session.userId);
        console.log('YouTube API Key exists:', !!YOUTUBE_API_KEY);
        console.log('API Key prefix:', YOUTUBE_API_KEY ? YOUTUBE_API_KEY.substring(0, 8) + '...' : 'none');
        
        const playlistId = req.body.playlistId || CAMPUSX_PLAYLIST_ID;
        console.log('Target Playlist ID:', playlistId);
        
        if (!YOUTUBE_API_KEY) {
            console.error('❌ ERROR: YouTube API key not configured');
            return res.status(500).json({ error: 'YouTube API key not configured in environment variables' });
        }

        // STEP 1: Test YouTube API connection
        console.log('\n📡 STEP 1: Testing YouTube API connection...');
        try {
            const testResponse = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
                params: { 
                    part: 'snippet', 
                    id: playlistId, 
                    key: YOUTUBE_API_KEY 
                },
                timeout: 10000
            });
            console.log('✅ YouTube API test successful');
            console.log('Response status:', testResponse.status);
            console.log('Items found:', testResponse.data.items?.length || 0);
            
            if (testResponse.data.items && testResponse.data.items.length > 0) {
                console.log('Playlist title:', testResponse.data.items[0].snippet.title);
            }
        } catch (testError) {
            console.error('❌ YouTube API test failed:');
            if (testError.response) {
                console.error('Status:', testError.response.status);
                console.error('Status Text:', testError.response.statusText);
                console.error('Error Data:', JSON.stringify(testError.response.data, null, 2));
                
                // Check for specific error reasons
                const errorReason = testError.response.data?.error?.errors?.[0]?.reason;
                if (errorReason === 'accessNotConfigured') {
                    console.error('❌ YouTube Data API v3 is not enabled in Google Cloud Console');
                } else if (errorReason === 'keyInvalid') {
                    console.error('❌ API key is invalid');
                } else if (errorReason === 'quotaExceeded') {
                    console.error('❌ API quota exceeded');
                }
            } else {
                console.error('Error Message:', testError.message);
            }
            
            return res.status(400).json({ 
                error: 'YouTube API connection failed',
                details: {
                    status: testError.response?.status,
                    message: testError.response?.data?.error?.message || testError.message,
                    reason: testError.response?.data?.error?.errors?.[0]?.reason
                }
            });
        }

        // STEP 2: Fetch playlist details
        console.log('\n📡 STEP 2: Fetching playlist details...');
        const playlistRes = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
            params: { 
                part: 'snippet', 
                id: playlistId, 
                key: YOUTUBE_API_KEY 
            }
        });

        if (!playlistRes.data.items || playlistRes.data.items.length === 0) {
            console.error('❌ Playlist not found on YouTube');
            return res.status(404).json({ error: 'Playlist not found on YouTube' });
        }

        const playlistInfo = playlistRes.data.items[0];
        console.log('✅ Playlist found:', playlistInfo.snippet.title);
        console.log('Channel:', playlistInfo.snippet.channelTitle);
        console.log('Description length:', playlistInfo.snippet.description?.length || 0);

        // STEP 3: Fetch all videos (handle pagination)
        console.log('\n📡 STEP 3: Fetching videos from playlist...');
        let allVideos = [];
        let nextPageToken = '';
        let pageCount = 0;
        
        do {
            pageCount++;
            console.log(`📥 Fetching page ${pageCount}...`);
            
            const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
                params: { 
                    part: 'snippet,contentDetails', 
                    playlistId: playlistId, 
                    maxResults: 50,
                    pageToken: nextPageToken,
                    key: YOUTUBE_API_KEY 
                }
            });

            if (videosRes.data.items && videosRes.data.items.length > 0) {
                allVideos = [...allVideos, ...videosRes.data.items];
                console.log(`   Added ${videosRes.data.items.length} videos`);
            }
            
            nextPageToken = videosRes.data.nextPageToken || '';
            
        } while (nextPageToken);

        console.log(`✅ Total videos found: ${allVideos.length} across ${pageCount} pages`);

        if (allVideos.length === 0) {
            console.error('❌ No videos found in playlist');
            return res.status(404).json({ error: 'No videos found in playlist' });
        }

        // STEP 4: Fetch video durations
        console.log('\n📡 STEP 4: Fetching video durations...');
        
        // Get all valid video IDs
        const videoIds = allVideos
            .map(item => item.contentDetails?.videoId)
            .filter(id => id && id.length > 0);
        
        console.log(`Found ${videoIds.length} valid video IDs`);
        
        let detailsRes = { data: { items: [] } };
        if (videoIds.length > 0) {
            // YouTube API can handle up to 50 IDs at once, so we need to chunk
            const chunkSize = 50;
            const chunks = [];
            for (let i = 0; i < videoIds.length; i += chunkSize) {
                chunks.push(videoIds.slice(i, i + chunkSize));
            }
            
            console.log(`Fetching durations in ${chunks.length} chunks...`);
            
            let allDetails = [];
            for (let i = 0; i < chunks.length; i++) {
                console.log(`   Fetching chunk ${i+1}/${chunks.length}...`);
                const chunkResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                    params: { 
                        part: 'contentDetails', 
                        id: chunks[i].join(','), 
                        key: YOUTUBE_API_KEY 
                    }
                });
                if (chunkResponse.data.items) {
                    allDetails = [...allDetails, ...chunkResponse.data.items];
                }
            }
            detailsRes.data.items = allDetails;
            console.log(`✅ Fetched durations for ${allDetails.length} videos`);
        }

        // Helper function to parse YouTube duration format (ISO 8601)
        function parseYouTubeDuration(duration) {
            if (!duration) return 0;
            
            try {
                const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                const hours = parseInt(match[1] || '0', 10);
                const minutes = parseInt(match[2] || '0', 10);
                const seconds = parseInt(match[3] || '0', 10);
                
                return (hours * 3600) + (minutes * 60) + seconds;
            } catch (err) {
                console.error('Error parsing duration:', duration, err);
                return 0;
            }
        }

        // STEP 5: Process videos
        console.log('\n📝 STEP 5: Processing videos...');
        const videos = [];
        let processedCount = 0;
        let failedCount = 0;
        
        for (let index = 0; index < allVideos.length; index++) {
            try {
                const item = allVideos[index];
                const videoId = item.contentDetails?.videoId;
                
                if (!videoId) {
                    failedCount++;
                    continue;
                }
                
                const detail = detailsRes.data.items?.find(v => v.id === videoId);
                
                // Parse duration
                let duration = 0;
                if (detail?.contentDetails?.duration) {
                    duration = parseYouTubeDuration(detail.contentDetails.duration);
                }
                
                // Get best available thumbnail
                let thumbnail = '';
                if (item.snippet?.thumbnails) {
                    thumbnail = item.snippet.thumbnails.maxres?.url || 
                                item.snippet.thumbnails.high?.url || 
                                item.snippet.thumbnails.medium?.url || 
                                item.snippet.thumbnails.default?.url || '';
                }
                
                videos.push({
                    videoId: videoId,
                    title: item.snippet?.title || `Video ${index + 1}`,
                    duration: duration,
                    thumbnail: thumbnail,
                    position: index,
                    completed: false
                });
                
                processedCount++;
                if (processedCount % 25 === 0) {
                    console.log(`   Processed ${processedCount}/${allVideos.length} videos...`);
                }
                
            } catch (err) {
                console.error('Error processing video at index', index, ':', err.message);
                failedCount++;
            }
        }

        console.log(`✅ Successfully processed ${processedCount} videos (${failedCount} failed)`);

        if (videos.length === 0) {
            console.error('❌ No videos could be processed');
            return res.status(500).json({ error: 'No videos could be processed' });
        }

        // STEP 6: Save to database
        console.log('\n💾 STEP 6: Saving to database...');
        
        const playlist = new Playlist({
            playlistId,
            title: playlistInfo.snippet?.title || 'Untitled Playlist',
            description: playlistInfo.snippet?.description || '',
            thumbnail: playlistInfo.snippet?.thumbnails?.maxres?.url || 
                      playlistInfo.snippet?.thumbnails?.high?.url || 
                      playlistInfo.snippet?.thumbnails?.medium?.url || 
                      playlistInfo.snippet?.thumbnails?.default?.url || '',
            videoCount: videos.length,
            userId: req.session.userId,
            videos: videos
        });
        
        await playlist.save();
        console.log('✅ Playlist saved to database successfully!');
        console.log('Playlist ID:', playlist._id);
        console.log('========== IMPORT COMPLETE ==========\n');
        
        res.status(201).json({
            success: true,
            message: 'Playlist imported successfully',
            playlist: {
                id: playlist._id,
                title: playlist.title,
                videoCount: videos.length
            }
        });
        
    } catch (error) {
        console.error('\n❌ ========== IMPORT ERROR ==========');
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Headers:', error.response.headers);
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        
        console.error('=====================================\n');
        
        res.status(500).json({ 
            error: 'Import failed',
            message: error.message,
            details: error.response?.data
        });
    }
});

// ===== GET USER PLAYLISTS =====
router.get('/user-playlists', auth, async (req, res) => {
    try {
        console.log('Fetching playlists for user:', req.session.userId);
        const playlists = await Playlist.find({ userId: req.session.userId });
        console.log(`Found ${playlists.length} playlists`);
        res.json(playlists);
    } catch (error) {
        console.error('Error fetching playlists:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== GET SINGLE PLAYLIST =====
router.get('/:playlistId', auth, async (req, res) => {
    try {
        console.log('Fetching playlist:', req.params.playlistId);
        const playlist = await Playlist.findOne({ 
            _id: req.params.playlistId, 
            userId: req.session.userId 
        });
        
        if (!playlist) {
            console.log('Playlist not found');
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        res.json(playlist);
    } catch (error) {
        console.error('Error fetching playlist:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== TOGGLE VIDEO COMPLETION =====
router.post('/:playlistId/video/:videoId/toggle', auth, async (req, res) => {
    try {
        console.log('Toggling video completion for playlist:', req.params.playlistId);
        
        const playlist = await Playlist.findOne({ 
            _id: req.params.playlistId, 
            userId: req.session.userId 
        });

        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        const video = playlist.videos.id(req.params.videoId);
        if (!video) {
            return res.status(404).json({ error: 'Video not found' });
        }

        video.completed = !video.completed;
        video.completedAt = video.completed ? new Date() : null;
        
        await playlist.save();
        
        // Calculate progress
        const completedCount = playlist.videos.filter(v => v.completed).length;
        const progress = (completedCount / playlist.videos.length) * 100;
        
        console.log('Video toggled. New progress:', progress.toFixed(1) + '%');
        
        res.json({ 
            video, 
            progress: {
                completed: completedCount,
                total: playlist.videos.length,
                percentage: progress
            }
        });
        
    } catch (error) {
        console.error('Error toggling video:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== UPDATE PLAYBACK SPEED =====
router.post('/:playlistId/speed', auth, async (req, res) => {
    try {
        console.log('Updating speed for playlist:', req.params.playlistId);
        
        const playlist = await Playlist.findOne({ 
            _id: req.params.playlistId, 
            userId: req.session.userId 
        });

        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        playlist.playlistSpeed = req.body.speed;
        await playlist.save();
        
        console.log('Speed updated to:', playlist.playlistSpeed);
        
        res.json({ speed: playlist.playlistSpeed });
        
    } catch (error) {
        console.error('Error updating speed:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
