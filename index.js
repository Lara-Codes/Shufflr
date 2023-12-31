require('dotenv').config();
const express = require("express");
const axios = require('axios');
const cors = require("cors");
const crypto = require('crypto');
const { connect } = require('http2');
const fetch = require('cross-fetch');
const cookieParser = require('cookie-parser'); // Storing in a cookie 

const app = express();
app.use(express.json());
app.use(cors())
app.use(cookieParser());

CLIENT_ID = process.env.CLIENT_ID;
CLIENT_SECRET = process.env.CLIENT_SECRET;
PORT = process.env.PORT;
REDIRECT_URI = process.env.REDIRECT_URI;
SCOPE = [
    "playlist-read-collaborative",
    "playlist-read-private",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-library-read",
    "user-modify-playback-state"
]

let verifier = null;
let songSet = new Set(); // Set to hold all songs 
let songArrayFromSet = null; // Array to send into playlist 100 at a time 

app.use(express.static(__dirname + '/public'))
    .use(cors())

app.get("/", (request, response) => {
    response.send("Welcome to my application!"); // or redirect to another route if desired
});

//PKCE Authorization Code 

//Code verifier generation 
function generateCodeVerifier(length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

//Generate code challenge
async function generateCodeChallenge(codeVerifier) {
    const sha256Digest = crypto.createHash('sha256').update(codeVerifier).digest();
    const base64Digest = Buffer.from(sha256Digest).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return base64Digest;
}

// Redirects to ask user if the app can give access
app.get("/login", async (request, response) => {
    verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);
    const redirect_url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${SCOPE}&state=123456&redirect_uri=${REDIRECT_URI}&prompt=consent&code_challenge_method=S256&code_challenge=${challenge}`
    response.redirect(redirect_url);
})

// Returns to callback route with verifier and access token 
app.get("/callback", async (request, response) => {
    const code = request.query["code"]
    let resp1 = await axios.post(
        url = 'https://accounts.spotify.com/api/token',
        data = new URLSearchParams({
            'grant_type': 'authorization_code',
            'redirect_uri': REDIRECT_URI,
            'code': code,
            'code_verifier': verifier
        }),
        config = {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            params: {
                'grant_type': 'client_credentials'
            },
            auth: {
                username: CLIENT_ID,
                password: CLIENT_SECRET
            }
        })
    // accessToken = resp1.data.access_token;
    response.cookie('access_token', resp1.data.access_token, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict', // Adjust as needed
        maxAge: 3600000, // Cookie expiration time in milliseconds (e.g., 1 hour)
    });
    return response.redirect("home.html");
})

// Clear the access token and any session data
app.get("/logout", (request, response) => {
    response.clearCookie("access_token");
    response.redirect("/");
});

app.get('/fetchProfile', async (req, res) => {
    try {
        const accessToken = req.cookies.access_token;
        const response = await fetch("https://api.spotify.com/v1/me", {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` }
        })
        const profile = await response.json();
        res.send(profile);
    } catch (error) {
        throw new Error("Error fetching profile: " + error);
    }
})

// function on frontend retrieves liked songs and sends them over here. This adds the songs to the set. 
app.get('/addLikedSongs', async (req, res) => {
    try {
        const accessToken = req.cookies.access_token;
        const limit = 50;
        let offset = 0;
        let allLiked = [];
        let songs = null;
        let i = 0;
        do {
            const result = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            const data = await result.json();
            songs = data.items.map(ob => ob.track).map(ob => ob.uri);
            let print = data.items.map(ob => ob.track).map(ob => ob.name)[i];
            allLiked = allLiked.concat(songs);
            offset += limit;

        } while (songs.length > 0);

        for (song of allLiked) {
            songSet.add(song);
        }
        res.sendStatus(200); // Sending a success response
    } catch (error) {
        console.error('Error adding liked songs:', error);
        res.sendStatus(500); // Sending an error response
    }
});

app.get('/fetchPlaylists', async (req, res) => {
    try {
        const accessToken = req.cookies.access_token;
        const limit = 50;
        let offset = 0;
        let allplaylists = [];
        let playlists = null;
        do {
            const result = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            const data = await result.json();
            playlists = data.items;
            allplaylists = allplaylists.concat(playlists);
            offset += limit;
        } while (playlists.length > 0);

        const playlist = allplaylists.find(item => item.name === "all_songs");
        const playlistId = playlist ? playlist.id : 0;
        all_songs = playlistId;
        res.send(JSON.stringify(playlistId));

    } catch (error) {
        console.error("Error while searching through playlists", error);
    }
});

let shufflePlaylist = null;
app.post('/findPlaylistsToShuffle', async (req, res) => {
    try {
        const { toFind } = req.body;
        // Sometimes a user has created a playlist name with a space at the end. Here is where 
        // we check for those cases. 
        const trailingSpace = toFind + " ";
        const startSpace = " " + toFind;

        const accessToken = req.cookies.access_token;
        const limit = 50;
        let offset = 0;
        let allplaylists = [];
        let playlists = null;

        do {
            const result = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            const data = await result.json();
            playlists = data.items;
            allplaylists = allplaylists.concat(playlists);
            offset += limit;
        } while (playlists.length > 0);

        let playlist = allplaylists.find(item => item.name === toFind);
        let playlistId = playlist ? playlist.id : 0;

        if (playlistId == 0) { // Checking for trailing white space on user's end 
            playlist = allplaylists.find(item => item.name === trailingSpace);
            playlistId = playlist ? playlist.id : 0;
        }

        if (playlistId == 0) { // Checking for beginning white space on user's end 
            playlist = allplaylists.find(item => item.name === startSpace);
            playlistId = playlist ? playlist.id : 0;
        }

        if (playlistId != 0) {
            shufflePlaylist = playlistId;
        }

        res.send(JSON.stringify(playlistId));
    } catch (error) {
        console.error("Error while fetching playlists for shuffling", error)
    }
})

// Gets size of playlist 
app.post('/getSizeOfPlaylist', async (req, res) => {
    try {
        const { num } = req.body;
        if (shufflePlaylist != null) {
            const accessToken = req.cookies.access_token;
            const limit = 50;
            let offset = 0;
            let trackList = [];

            let track = null;
            do {
                const result = await fetch(`https://api.spotify.com/v1/playlists/${shufflePlaylist}/tracks?limit=${limit}&offset=${offset}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    }
                });
                const data = await result.json();
                track = data.items.map(ob => ob.track.uri);
                trackList = trackList.concat(track);
                offset += limit;
            } while (track.length > 0);
            await randomizePlaylist(trackList, accessToken, num);
            res.sendStatus(200);
        }
    } catch (error) {
        console.error("Error retrieving size of playlist", error);
    }
})
// Fisher-Yates algorithm to randomize array 
async function randomizePlaylist(array, token, num) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }

    try {
        let max = 0;
        if (num > array.length) {
            max = array.length;
        } else {
            max = num;
        }
        for (const uri of array.slice(0, max)) {
            let result = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${uri}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                }
            });
            console.log(result);

            if (result.status === 404) {
                console.log(`Track not found in Spotify catalog: ${uri}`);
            } else if (result.ok) {
                console.log(`Successfully added ${uri} to queue`);
            } else {
                console.log(`Error adding ${uri} to queue. Status: ${result.status}`);
            }

        }
    } catch (error) {
        console.error("Error adding to queue", error);
    }

}

let all_songs = null;
app.get('/removePlaylist', async (req, res) => {
    try {
        const accessToken = req.cookies.access_token;
        const unfollow = await fetch(`https://api.spotify.com/v1/playlists/${all_songs}/followers`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        console.log("Promise fulfilled");
        res.sendStatus(200);
    } catch (error) {
        console.log("Error getting songs from all-songs", error);
    }
})

// Fetches album list. For each batch of 50 albums, sends to function getTracksForEach. 
// This function adds the songs to a set. 
app.post('/fetchAlbumList', async (req, res) => {
    const limit = 50;
    let offset = 0;
    let allAlbums = []; // array of album ids 

    console.log("Fetching album list...");
    try {
        const accessToken = req.cookies.access_token;
        let albums = null;
        do {
            const result = await fetch(`https://api.spotify.com/v1/me/albums?limit=${limit}&offset=${offset}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                }
            });
            const data = await result.json();
            await getTracksForEach(data, req); // Batch of tracks 
            albums = data.items.map(ob => ob.album.id);
            allAlbums = allAlbums.concat(albums);
            offset += limit;
        } while (albums.length > 0);
        console.log("All songs added to set.");
        songArrayFromSet = Array.from(songSet); // Converts song set to array when all is said and done 
        res.sendStatus(200);
    } catch (error) {
        console.error("Error fetching albums:", error);
        throw error; // Rethrow the error to be caught at the higher level
    }
});

// Helper function for /fetchAlbumList route. Appends tracks for each batch of 50 albums to set. 
async function getTracksForEach(data, req) {
    try {
        console.log("In one batch.");
        let trackBatchTotalTracks = data.items.map(ob => ob.album).map(ob => ob.total_tracks); // Data is an array of 50 album infos. 
        let trackBatchSongUri = data.items.map(ob => ob.album).map(ob => ob.tracks).map(ob => ob.items).flat().map(track => track.uri) // array of albums
        for (let i = 0; i < trackBatchTotalTracks.length; i++) {
            if (trackBatchTotalTracks[i] >= 50) {
                // Pass ID to another function, handle with pagination  
                await handlePagination(data.items[i].album.id, req);
                console.log("pagination handled.")
            } else {
                // Add tracks directly to set 
                for (song of trackBatchSongUri) {
                    songSet.add(song);
                }
            }
        }
        console.log("All songs compiled.")
    } catch (error) {
        console.error("Error getting tracks for each.", error)
    }
}

// If there are >50 tracks in an album, this function deals with that. 
async function handlePagination(albumId, req) {
    const accessToken = req.cookies.access_token;
    const limit = 50;
    let offset = 0;
    let trackList = [];

    console.log("Handling pagination...");
    let tracks = null;
    do {
        const result = await fetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            }
        });

        const data = await result.json();
        tracks = data.items.map(ob => ob.uri);
        trackList = trackList.concat(tracks);
        offset += limit;
    } while (tracks.length > 0)

    for (song of trackList) {
        songSet.add(song);
    }
}
app.post('/addSongsToPlaylist', async (req, res) => {
    const { profileid } = req.body;
    try {
        const accessToken = req.cookies.access_token;
        const response = await fetch(`https://api.spotify.com/v1/users/${profileid}/playlists`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: 'all_songs',
                description: 'Includes all liked songs, albums, & playlists created by you. App by @artbylarapalombi on Instagram.'
            })
        })
        const data = await response.json();
        let playlistid = data.id;
        await batchSongs(playlistid, req);
        res.sendStatus(200);
    } catch (error) {
        throw new Error("Error creating playlist: " + error);
    }
})

// Sends songs to playlist in batches. 
async function batchSongs(playlistid, req) {
    let limit = 100;
    let offset = 0;
    const songArrayCopy = songArrayFromSet.slice();
    console.log("Length: " + songArrayFromSet.length);
    let batch = [];
    console.log("Total songs to add: " + songArrayFromSet.length);

    while (offset < songArrayFromSet.length) {
        const batch = songArrayFromSet.slice(offset, offset + limit);

        if (batch.length > 0) {
            await sendSongsToPlaylist(batch, playlistid, req);
            console.log("Batch added: " + batch.length);
        }

        offset += limit;
    }
}

async function sendSongsToPlaylist(songarr, playlistid, req) {
    console.log("Error here? ")
    const accessToken = req.cookies.access_token;
    const result = await fetch(`https://api.spotify.com/v1/playlists/${playlistid}/tracks`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ "uris": songarr })
    });

    const data = await result.json();
    console.log(data); // Log the response data to check for any errors
}

console.log('Listening on 5173');
app.listen(5173);
