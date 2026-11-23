# Quaver

A sheet music maker that runs in your browser: **https://the8thalian.github.io/quaver/**

- Write music for 44 instruments, from piano and strings to saxophones, electric guitar and drum kit
- Hear it played, with dynamics, ornaments, repeats, swing and a mixer
- Concert scores that split into transposed parts for each player
- ✨ Compose writes an original piece in the style you pick
- Sing or play into the mic, or upload a recording, and it becomes notation
- Practice mode listens while you play along and marks each note right or wrong
- Ask Sonnet (with your own Anthropic API key) for dynamics, harmonies, bass lines and arrangements
- Import MIDI and MusicXML; save as MIDI, MusicXML, WAV, MP4 video, PNG or PDF

## Run it on your computer

It's plain HTML and JavaScript with no build step. Serve the folder and open it:

```bash
python3 -m http.server 5173
```

Then go to http://localhost:5173. (The microphone needs `localhost` or `https`.)

## Files

- `index.html`: the page and its styles
- `js/`: theory and instruments, notation drawing, sound, import/export, mic and Sonnet, the composer, video export, and the editor
- `fonts/embed.css`: the fonts built into PNG and video exports
- `tools/build_publish.py`: builds the copy published on claude.ai
