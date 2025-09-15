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

