/* replacer.jsx — Premiere Pro 2022
 * Immer ERSTER Clip je Spur:
 *  - V1: Video ersetzen
 *  - V2: Video ersetzen + verlinktes Audio löschen
 *  - A1: Audio ersetzen
 * Ripple nur auf V1, V2 und A1; V3–V5 unberührt.
 */

function replacer_ping() {
    try {
        if (app && app.project && app.project.activeSequence) {
            return "OK: " + app.project.activeSequence.name;
        }
        return "Kein aktives Projekt/Sequenz.";
    } catch (e) {
        return "Fehler: " + e;
    }
}

function replacer_pickFile() {
    try {
        var f = File.openDialog("Neuen Clip wählen", "*.*", false);
        if (f) { return f.fsName; }
        return null;
    } catch (e) {
        return null;
    }
}

function _findOrImportProjectItem(absPath) {
    function _searchBin(bin) {
        for (var i = 0; i < bin.children.numItems; i++) {
            var it = bin.children[i];
            if (it && it.type === ProjectItemType.CLIP && it.getMediaPath && it.getMediaPath() === absPath) {
                return it;
            }
            if (it && it.type === ProjectItemType.BIN) {
                var found = _searchBin(it);
                if (found) return found;
            }
        }
        return null;
    }
    var root = app.project.rootItem;
    var found = _searchBin(root);
    if (found) return found;

    var ok = app.project.importFiles([absPath], true, root, false);
    if (!ok || !ok[0]) throw "Import fehlgeschlagen: " + absPath;

    found = _searchBin(root);
    if (!found) throw "Importierte Datei nicht auffindbar.";
    return found;
}

// ---- NEU: Immer ersten Clip bestimmen (kleinste Startzeit) ----
function _getFirstClipOnTrack(track) {
    var best = null;
    var bestStart = null;
    for (var i = 0; i < track.clips.numItems; i++) {
        var c = track.clips[i];
        if (!c || !c.start) continue;
        var st = c.start.ticks;
        if (best == null || st < bestStart) {
            best = c;
            bestStart = st;
        }
    }
    return best;
}

function _projectItemMediaDurationTicks(pi) {
    // Medienlänge ermitteln (über QE, wenn möglich)
    app.enableQE();
    var qeProj = qe.project;
    var durTicks = null;
    try {
        var path = pi.getMediaPath();
        if (path) {
            var num = qeProj.numItems;
            for (var i = 0; i < num; i++) {
                var it = qeProj.getItemAt(i);
                if (it && it.getMediaPath && it.getMediaPath() === path) {
                    var frameRate = app.project.activeSequence.timebase || 25;
                    var framesDur = it.numVideoFrames; // -1 bei Audio-only
                    if (framesDur && framesDur > 0) {
                        var ticksPerSecond = 254016000000.0;
                        var fps = frameRate;
                        durTicks = Math.round((framesDur / fps) * ticksPerSecond);
                        break;
                    }
                }
            }
        }
    } catch (e) {}
    return durTicks;
}

function _timeFromTicks(ticks) {
    var t = new Time();
    t.ticks = ticks;
    return t;
}

function _shiftFollowingClipsOnTrack(track, fromTicks, deltaTicks) {
    if (!deltaTicks || deltaTicks === 0) return;
    for (var i = 0; i < track.clips.numItems; i++) {
        var c = track.clips[i];
        if (!c) continue;
        var st = c.start.ticks;
        if (st >= fromTicks) {
            c.start.ticks = st + deltaTicks;
            c.end.ticks = c.end.ticks + deltaTicks;
        }
    }
}

function _removeLinkedAudioOfTrackItem(trackItem) {
    // Entfernt verlinkte Audio-Items des gerade eingesetzten Video-TrackItems (z. B. auf V2)
    try {
        if (!trackItem || !trackItem.getLinkedItems) return;
        var linked = trackItem.getLinkedItems();
        if (!linked || !linked.numItems) return;
        for (var i = 0; i < linked.numItems; i++) {
            var li = linked[i];
            try {
                if (li && li.track && li.track.mediaType && ("" + li.track.mediaType).toLowerCase() === "audio") {
                    li.remove(0, 0);
                }
            } catch (e) {}
        }
    } catch (e2) {}
}

function replacer_run(absPath /*, preferSelection ignored */) {
    var out = { ok: false, v1DeltaFrames: 0, v2DeltaFrames: 0, a1DeltaFrames: 0, error: "" };
    try {
        if (!app.project || !app.project.activeSequence) {
            out.error = "Keine aktive Sequenz.";
            return JSON.stringify(out);
        }
        var seq = app.project.activeSequence;

        // Zielspuren
        var v1 = seq.videoTracks[0]; // V1
        var v2 = seq.videoTracks[1]; // V2
        var a1 = seq.audioTracks[0]; // A1
        if (!v1) { out.error = "Videospur V1 nicht gefunden."; return JSON.stringify(out); }
        if (!v2) { out.error = "Videospur V2 nicht gefunden."; return JSON.stringify(out); }
        if (!a1) { out.error = "Audiospur A1 nicht gefunden."; return JSON.stringify(out); }

        // Immer ERSTER Clip je Spur
        var clipV1 = _getFirstClipOnTrack(v1);
        var clipV2 = _getFirstClipOnTrack(v2);
        var clipA1 = _getFirstClipOnTrack(a1); // falls vorhanden

        if (!clipV1 && !clipV2) {
            out.error = "Keine Clips auf V1/V2 gefunden.";
            return JSON.stringify(out);
        }

        // Neues Projekt-Item (Quelle)
        var pi = _findOrImportProjectItem(absPath);
        if (!pi) { out.error = "ProjectItem nicht gefunden."; return JSON.stringify(out); }

        // Medienlänge
        var mediaTicks = _projectItemMediaDurationTicks(pi); // kann null sein
        var ticksPerSecond = 254016000000.0;
        var fps = seq.timebase || 25;
        function framesToTicks(fr) { return Math.round((fr / fps) * ticksPerSecond); }
        function ticksToFrames(ti) { return Math.round((ti / ticksPerSecond) * fps); }

        // Helper: VIDEO ersetzen + Ripple auf gleichem Track
        function _replaceVideoOnTrack(track, oldClip, dropLinkedAudio) {
            if (!oldClip) return { deltaTicks: 0 };
            var startT = oldClip.start.ticks;
            var oldDur = oldClip.end.ticks - oldClip.start.ticks;

            var newItem = null;
            try {
                newItem = track.overwriteClip(pi, _timeFromTicks(startT));
            } catch (e) {
                try {
                    oldClip.remove(0, 0);
                    newItem = track.overwriteClip(pi, _timeFromTicks(startT));
                } catch (e2) {
                    throw "Overwrite (Video) fehlgeschlagen: " + e2;
                }
            }
            if (!newItem) throw "Neues Video-TrackItem konnte nicht erzeugt werden.";

            // Ziel-Länge (Medienlänge bevorzugt)
            var newDur = mediaTicks ? mediaTicks : (newItem.end.ticks - newItem.start.ticks);
            newItem.end = _timeFromTicks(startT + newDur);

            if (dropLinkedAudio) {
                _removeLinkedAudioOfTrackItem(newItem);
            }

            var delta = (newDur - oldDur);
            // Nachfolgende Items AB altem Ende verschieben
            var fromT = startT + oldDur;
            if (delta !== 0) {
                _shiftFollowingClipsOnTrack(track, fromT, delta);
            }
            return { deltaTicks: delta };
        }

        // Helper: AUDIO auf A1 ersetzen + Ripple auf A1
        function _replaceAudioOnA1(oldAudioClip, startTicksForFallback) {
            var startT = null;
            var oldDur = 0;
            if (oldAudioClip) {
                startT = oldAudioClip.start.ticks;
                oldDur = oldAudioClip.end.ticks - oldAudioClip.start.ticks;
            } else {
                // Fallback: gleiche Startzeit wie V1, sonst V2, sonst 0
                if (clipV1) startT = clipV1.start.ticks;
                else if (clipV2) startT = clipV2.start.ticks;
                else if (startTicksForFallback != null) startT = startTicksForFallback;
                else startT = 0;
            }

            if (oldAudioClip) {
                oldAudioClip.remove(0, 0);
            }

            var newA1 = null;
            try {
                newA1 = a1.overwriteClip(pi, _timeFromTicks(startT));
            } catch (e) {
                throw "Overwrite (Audio A1) fehlgeschlagen: " + e;
            }
            if (!newA1) throw "Neues Audio-TrackItem auf A1 konnte nicht erzeugt werden.";

            var newDur = mediaTicks ? mediaTicks : (newA1.end.ticks - newA1.start.ticks);
            newA1.end = _timeFromTicks(startT + newDur);

            var delta = (newDur - oldDur);
            var fromT = startT + oldDur;
            if (delta !== 0) {
                _shiftFollowingClipsOnTrack(a1, fromT, delta);
            }
            return { deltaTicks: delta };
        }

        // 1) V1 → erster Clip ersetzen
        var rV1 = _replaceVideoOnTrack(v1, clipV1, /*dropLinkedAudio*/ false);

        // 2) V2 → erster Clip ersetzen + Audio verwerfen
        var rV2 = _replaceVideoOnTrack(v2, clipV2, /*dropLinkedAudio*/ true);

        // 3) A1 → Audio ersetzen (erster Clip, falls vorhanden; sonst Start von V1/V2)
        var rA1 = _replaceAudioOnA1(clipA1, (clipV1 ? clipV1.start.ticks : (clipV2 ? clipV2.start.ticks : 0)));

        out.ok = true;
        out.v1DeltaFrames = ticksToFrames(rV1.deltaTicks);
        out.v2DeltaFrames = ticksToFrames(rV2.deltaTicks);
        out.a1DeltaFrames = ticksToFrames(rA1.deltaTicks);
        return JSON.stringify(out);

    } catch (e) {
        out.ok = false;
        out.error = e.toString ? e.toString() : ("" + e);
        return JSON.stringify(out);
    }
}
