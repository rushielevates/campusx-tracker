

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

router.post('/import', auth, async (req, res) => {
    try {
        const playlistId = req.body.playlistId || CAMPUSX_PLAYLIST_ID;
        
        const playlistRes = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
            params: { part: 'snippet', id: playlistId, key: YOUTUBE_API_KEY }
        });
        
        const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
            params: { part: 'snippet', playlistId, maxResults: 50, key: YOUTUBE_API_KEY }
        });
        
        const videoIds = videosRes.data.items.map(item => item.contentDetails.videoId).join(',');
        const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: { part: 'contentDetails', id: videoIds, key: YOUTUBE_API_KEY }
        });
        
        const videos = videosRes.data.items.map((item, index) => {
            const detail = detailsRes.data.items.find(v => v.id === item.contentDetails.videoId);
            const duration = parseYouTubeDuration(detail.contentDetails.duration);
            return {
                videoId: item.contentDetails.videoId,
                title: item.snippet.title,
                duration: duration,
                thumbnail: item.snippet.thumbnails.medium.url,
                position: index,
                completed: false
            };
        });
        
        const playlist = new Playlist({
            playlistId,
            title: playlistRes.data.items[0].snippet.title,
            description: playlistRes.data.items[0].snippet.description,
            thumbnail: playlistRes.data.items[0].snippet.thumbnails.medium.url,
            videoCount: videos.length,
            userId: req.session.userId,
            videos
        });
        
        await playlist.save();
        res.status(201).json(playlist);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function parseYouTubeDuration(duration) {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    const hours = (match[1] || '').replace('H', '') || 0;
    const minutes = (match[2] || '').replace('M', '') || 0;
    const seconds = (match[3] || '').replace('S', '') || 0;
    return (parseInt(hours) * 3600) + (parseInt(minutes) * 60) + parseInt(seconds);
}

router.get('/user-playlists', auth, async (req, res) => {
    try {
        const playlists = await Playlist.find({ userId: req.session.userId });
        res.json(playlists);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:playlistId', auth, async (req, res) => {
    try {
        const playlist = await Playlist.findOne({ _id: req.params.playlistId, userId: req.session.userId });
        if (!playlist) return res.status(404).json({ error: 'Not found' });
        res.json(playlist);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:playlistId/video/:videoId/toggle', auth, async (req, res) => {
    try {
        const playlist = await Playlist.findOne({ _id: req.params.playlistId, userId: req.session.userId });
        const video = playlist.videos.id(req.params.videoId);
        video.completed = !video.completed;
        video.completedAt = video.completed ? new Date() : null;
        await playlist.save();
        res.json({ video, progress: playlist.getProgress(), remainingTime: playlist.getRemainingTime() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:playlistId/speed', auth, async (req, res) => {
    try {
        const playlist = await Playlist.findOne({ _id: req.params.playlistId, userId: req.session.userId });
        playlist.playlistSpeed = req.body.speed;
        await playlist.save();
        res.json({ speed: playlist.playlistSpeed, remainingTime: playlist.getRemainingTime() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
