// This is the function that will be injected into the page to perform the action.
function toggleLargestVideoOrAudio() {
    const mediaElements = [...document.querySelectorAll("video, audio")];
    if (mediaElements.length === 0)
        return;

    const largestMedia = mediaElements.sort((a, b) => 
        (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];

    if (largestMedia.paused) {
        largestMedia.play().catch((e) => console.log("Play interrupted:", e.message));
    }
    else {
        largestMedia.pause();
    }
}

// This function finds the active tab and executes the script.
export async function togglePlaybackOnActiveTab() {
    const queryOptions = { active: true, lastFocusedWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);

    if (!tab || !tab.id) {
        console.warn("[PlayerControl] no active tab found");
        return false;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: toggleLargestVideoOrAudio,
        });
        console.log(`[PlayerControl] Toggle command sent to tab ${tab.id}`);
        return true
    } catch (error) {
        console.log(`[PlayerControl] Failed to execute script on tab ${tab.id}`);
        return false
    }
}

function toggleMuteLargestVideo() {
    const mediaElements = [...document.querySelectorAll("video, audio")];
    if (mediaElements.length === 0)
        return;

    const largestMedia = mediaElements.sort((a, b) => 
        (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];

    largestMedia.muted = !largestMedia.muted;
}

export async function toggleMuteOnActiveTab() {
    const queryOptions = { active: true, lastFocusedWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);

    if (!tab || !tab.id) {
        console.warn("[PlayerControl] no active tab found");
        return false;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: toggleMuteLargestVideo,
        });
        console.log(`[PlayerControl] Mute command sent to tab ${tab.id}`);
        return true
    } catch (error) {
        console.log(`[PlayerControl] Failed to execute mute script on tab ${tab.id}`);
        return false
    }
}

function seekLargestVideo(seconds) {
    const mediaElements = [...document.querySelectorAll("video, audio")];
    if (mediaElements.length == 0)
        return;

    const largestMedia = mediaElements.sort((a, b) => 
        (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];

    largestMedia.currentTime += seconds;
}

export async function seekOnActiveTab(seconds) {
    const queryOptions = { active: true, lastFocusedWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);

    if (!tab || !tab.id) {
        console.warn("[PlayerControl] no active tab found")
        return false;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: seekLargestVideo,
            args: [seconds], // Pass the 'seconds' value here
        });
        console.log(`[PlayerControl] Seek command (${seconds}s) sent to tab ${tab.id}`);
        return true
    } catch (error) {
        console.log(`[PlayerControl] Failed to execute seek script on tab ${tab.id}: ${error}`);
        return false
    }
}

function setLargestVideoVolume(level) {
    const mediaElements = [...document.querySelectorAll("video, audio")];
    if (mediaElements.length === 0)
        return;

    const largestMedia = mediaElements.sort((a, b) => 
        (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];

    // Ensure volume is within the valid 0.0 to 1.0 range
    const newVolume = Math.max(0, Math.min(1, level));
    
    largestMedia.volume = newVolume;

    // A nice UX touch: if the user is changing the volume, they probably want it unmuted.
    if (newVolume > 0) {
        largestMedia.muted = false;
    }
}

export async function setVolumeOnActiveTab(level) {
    queryOptions = { active: true, lastFocusedWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);

    if (!tab || !tab.id) {
        console.warn("[PlayerControl] no active tab found");
        return false;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: setLargestVideoVolume,
            args: [level],
        });
        console.log(`[PlayerControl] Volume command (${level}) sent to tab ${tab.id}`);
        return true
    } catch (error) {
        console.log(`[PlayerControl] Failed to execute volume script on tab ${tab.id}: ${error}`);
        return false
    }
}