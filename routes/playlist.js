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

// MAIN IMPORT ROUTE - UPDATED WITH ERROR HANDLING
router.post('/import', auth, async (req, res) => {
    try {
        console.log('🚀 Starting playlist import...');
        const playlistId = req.body.playlistId || CAMPUSX_PLAYLIST_ID;
        
        if (!YOUTUBE_API_KEY) {
            return res.status(500).json({ error: 'YouTube API key not configured in environment variables' });
        }

        console.log('📡 Fetching playlist details for ID:', playlistId);
        
        // Fetch playlist details
        const playlistRes = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
            params: { 
                part: 'snippet', 
                id: playlistId, 
                key: YOUTUBE_API_KEY 
            }
        });

        if (!playlistRes.data.items || playlistRes.data.items.length === 0) {
            return res.status(404).json({ error: 'Playlist not found on YouTube' });
        }

        const playlistInfo = playlistRes.data.items[0];
        console.log('✅ Playlist found:', playlistInfo.snippet.title);

        // Fetch playlist videos
        console.log('📡 Fetching videos from playlist...');
        let allVideos = [];
        let nextPageToken = '';
        
        // Loop to get all videos (handles pagination)
        do {
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
            }
            
            nextPageToken = videosRes.data.nextPageToken || '';
            console.log(`📥 Fetched ${allVideos.length} videos so far...`);
            
        } while (nextPageToken);

        console.log(`✅ Total videos found: ${allVideos.length}`);

        if (allVideos.length === 0) {
            return res.status(404).json({ error: 'No videos found in playlist' });
        }

        // Get all video IDs for duration fetch
        const videoIds = allVideos
            .map(item => item.contentDetails?.videoId)
            .filter(id => id) // Remove undefined
            .join(',');

        // Fetch video durations
        console.log('📡 Fetching video durations...');
        let detailsRes = { data: { items: [] } };
        if (videoIds) {
            detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { 
                    part: 'contentDetails', 
                    id: videoIds, 
                    key: YOUTUBE_API_KEY 
                }
            });
        }

        // Helper function to parse YouTube duration format
        function parseYouTubeDuration(duration) {
            if (!duration) return 0;
            
            const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
            const hours = (match[1] || '').replace('H', '') || 0;
            const minutes = (match[2] || '').replace('M', '') || 0;
            const seconds = (match[3] || '').replace('S', '') || 0;
            
            return (parseInt(hours) * 3600) + (parseInt(minutes) * 60) + parseInt(seconds);
        }

        // Create videos array with error handling for each video
        const videos = allVideos.map((item, index) => {
            try {
                const videoId = item.contentDetails?.videoId;
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
                                item.snippet.thumbnails.default?.url || 
                                '';
                }
                
                return {
                    videoId: videoId || `unknown-${index}`,
                    title: item.snippet?.title || 'Untitled',
                    duration: duration,
                    thumbnail: thumbnail,
                    position: index,
                    completed: false
                };
            } catch (err) {
                console.error('❌ Error processing video:', err);
                return null;
            }
        }).filter(v => v !== null); // Remove any failed videos

        if (videos.length === 0) {
            return res.status(500).json({ error: 'No videos could be processed' });
        }

        console.log(`✅ Successfully processed ${videos.length} videos`);

        // Create playlist in database
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
        
        res.status(201).json({
            message: 'Playlist imported successfully',
            playlist: {
                id: playlist._id,
                title: playlist.title,
                videoCount: videos.length
            }
        });
        
    } catch (error) {
        console.error('❌ Import error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        
        // Send appropriate error message
        if (error.response?.status === 403) {
            res.status(403).json({ error: 'YouTube API key invalid or quota exceeded' });
        } else if (error.response?.status === 404) {
            res.status(404).json({ error: 'Playlist not found' });
        } else {
            res.status(500).json({ 
                error: error.message,
                details: error.response?.data 
            });
        }
    }
});

// GET USER PLAYLISTS
router.get('/user-playlists', auth, async (req, res) => {
    try {
        const playlists = await Playlist.find({ userId: req.session.userId });
        res.json(playlists);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET SINGLE PLAYLIST
router.get('/:playlistId', auth, async (req, res) => {
    try {
        const playlist = await Playlist.findOne({ 
            _id: req.params.playlistId, 
            userId: req.session.userId 
        });
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        res.json(playlist);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// TOGGLE VIDEO COMPLETION
router.post('/:playlistId/video/:videoId/toggle', auth, async (req, res) => {
    try {
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
        
        res.json({ 
            video, 
            progress: {
                completed: completedCount,
                total: playlist.videos.length,
                percentage: progress
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATE PLAYBACK SPEED
router.post('/:playlistId/speed', auth, async (req, res) => {
    try {
        const playlist = await Playlist.findOne({ 
            _id: req.params.playlistId, 
            userId: req.session.userId 
        });

        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        playlist.playlistSpeed = req.body.speed;
        await playlist.save();
        
        res.json({ speed: playlist.playlistSpeed });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
