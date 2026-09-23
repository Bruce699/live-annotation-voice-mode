import Foundation
import Speech
import AVFoundation
import CoreAudio
import AppKit
import Darwin
func argument(_ flag: String) -> String? { guard let i = CommandLine.arguments.firstIndex(of: flag), i+1 < CommandLine.arguments.count else { return nil }; return CommandLine.arguments[i+1] }
let eventFile = argument("--events").flatMap { FileHandle(forWritingAtPath: $0) }
func emit(_ value: [String: Any]) {
 if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { if let eventFile { eventFile.seekToEndOfFile(); eventFile.write(Data((text+"\n").utf8)) } else { print(text); fflush(stdout) } }
}
let locale = CommandLine.arguments.dropFirst().first ?? Locale.current.identifier
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
if CommandLine.arguments.contains("--check") { emit(["available": recognizer?.supportsOnDeviceRecognition ?? false, "locale": locale]); exit(0) }
// Boost quiet input before recognition without gating or clipping audio.
final class QuietInputGain {
 var gain: Float = 1
 func process(_ buffer: AVAudioPCMBuffer) -> Float {
  guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return 0 }
  let frames = Int(buffer.frameLength), channelCount = Int(buffer.format.channelCount)
  var total: Float = 0, peak: Float = 0
  for channel in 0..<channelCount {
   for frame in 0..<frames {
    let sample = channels[channel][frame]
    total += sample * sample; peak = max(peak, abs(sample))
   }
  }
  let rms = sqrt(total / Float(frames * channelCount))
  let target = min(4, max(1, 0.025 / max(rms, 0.0001)))
  gain += (target - gain) * (target < gain ? 0.6 : 0.15)
  let applied = min(gain, max(1, 0.9 / max(peak, 0.0001)))
  for channel in 0..<channelCount {
   for frame in 0..<frames { channels[channel][frame] *= applied }
  }
  // Keep the visual meter tied to the original dynamics, not the gain boost.
  return min(1, rms * 8)
 }
}
final class Dictation: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
 let inputGain = QuietInputGain()
 let capture = AVCaptureSession()
 let captureQueue = DispatchQueue(label: "live-annotation.capture")
 let audioQueue = DispatchQueue(label: "live-annotation.audio")
 var microphoneName = "microphone"
 var receivedAudio = false
 var receivedSpeech = false
 var reportedError = false
 var finishing = false
 var captureObserver: NSObjectProtocol?
 let requestLock = NSLock()
 var request: SFSpeechAudioBufferRecognitionRequest?
 var task: SFSpeechRecognitionTask?
 var started = Date()
 var completed: [[String: Any]] = []
 var partial: [[String: Any]] = []
 var stopping = false
 var generation = 0
 var lastLevel = Date.distantPast
 var fileTimer: Timer?
 func fail(_ message: String) { guard !finishing else { return }; reportedError = true; emit(["type":"error", "message":message]); finish() }
 func start() {
  guard let recognizer, recognizer.supportsOnDeviceRecognition else { fail("On-device dictation is unavailable for this language. Enable Dictation in macOS Keyboard settings and try again."); return }
  let microphones = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone], mediaType: .audio, position: .unspecified).devices
  guard let device = microphones.first(where: { UInt32(bitPattern: $0.transportType) == kAudioDeviceTransportTypeBuiltIn }) else { fail("The Mac’s built-in microphone is unavailable."); return }
  microphoneName = device.localizedName
  do {
   let input = try AVCaptureDeviceInput(device: device)
   let output = AVCaptureAudioDataOutput()
   output.audioSettings = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false]
   output.setSampleBufferDelegate(self, queue: audioQueue)
   capture.beginConfiguration()
   guard capture.canAddInput(input), capture.canAddOutput(output) else { capture.commitConfiguration(); fail("Unable to capture audio from " + microphoneName + "."); return }
   capture.addInput(input); capture.addOutput(output); capture.commitConfiguration()
   started = Date(); newRequest()
   captureObserver = NotificationCenter.default.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: capture, queue: .main) { note in
    let error = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
    self.fail("Microphone capture stopped: " + (error?.localizedDescription ?? self.microphoneName))
   }
   emit(["type":"input", "name":microphoneName])
   captureQueue.async {
    self.capture.startRunning()
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
     if !self.receivedAudio && !self.stopping && !self.finishing { self.fail("No audio is arriving from " + self.microphoneName + ". Reconnect this microphone or select another input in macOS Sound settings.") }
    }
   }
  } catch { fail("The microphone could not start: \(error.localizedDescription)") }
 }
 func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
  guard let description = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
  let format = AVAudioFormat(cmAudioFormatDescription: description)
  let count = CMSampleBufferGetNumSamples(sampleBuffer)
  guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)) else { return }
  buffer.frameLength = AVAudioFrameCount(count)
  guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sampleBuffer, at: 0, frameCount: Int32(count), into: buffer.mutableAudioBufferList) == noErr else { return }
  let level = inputGain.process(buffer)
  requestLock.lock(); request?.append(buffer); requestLock.unlock()
  DispatchQueue.main.async {
   guard !self.finishing else { return }
   if !self.receivedAudio { self.receivedAudio = true; if !self.stopping { emit(["type":"ready", "startedAt":self.started.timeIntervalSince1970 * 1000]) } }
   if Date().timeIntervalSince(self.lastLevel) > 0.08 { self.lastLevel = Date(); emit(["type":"level", "value":level]) }
  }
 }
 func startFile(_ url: URL) {
  do {
   let file = try AVAudioFile(forReading: url)
   started = Date(); newRequest()
   emit(["type":"ready", "startedAt":started.timeIntervalSince1970 * 1000])
   fileTimer = Timer.scheduledTimer(withTimeInterval: 1024 / file.processingFormat.sampleRate, repeats: true) { timer in
    guard file.framePosition < file.length else { timer.invalidate(); self.stop(); return }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1024) else { self.fail("Unable to read audio fixture"); return }
    do { try file.read(into: buffer, frameCount: 1024); _ = self.inputGain.process(buffer); self.requestLock.lock(); self.request?.append(buffer); self.requestLock.unlock() }
    catch { timer.invalidate(); self.fail(error.localizedDescription) }
   }
  } catch { fail(error.localizedDescription) }
 }
 func newRequest() {
  generation += 1; let current = generation, base = Date().timeIntervalSince(started)
  let next = SFSpeechAudioBufferRecognitionRequest()
  next.taskHint = .dictation; next.shouldReportPartialResults = true; next.requiresOnDeviceRecognition = true; next.addsPunctuation = true; requestLock.lock(); request = next; requestLock.unlock()
  task = recognizer?.recognitionTask(with: next) { result, error in
   DispatchQueue.main.async {
    guard current == self.generation else { return }
    if let result {
     if !result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { self.receivedSpeech = true }
     self.partial = result.bestTranscription.segments.map { ["text":$0.substring, "start":base + $0.timestamp, "end":base + $0.timestamp + $0.duration] }
     emit(["type":"recognition", "task":current, "at":Date().timeIntervalSince(self.started), "settled":result.isFinal || result.speechRecognitionMetadata != nil, "hasTiming":result.bestTranscription.segments.contains { $0.duration > 0 }, "words":self.partial])
     if result.isFinal { self.completed += self.partial; self.partial = []; if self.stopping { self.finish() } else { self.newRequest() }; return }
    }
    if let error { if self.stopping { self.finish() } else { self.fail("Dictation stopped: \(error.localizedDescription)") } }
   }
  }
 }
 func stop() {
  guard !stopping else { return }; stopping = true; fileTimer?.invalidate()
  captureQueue.async {
   if self.capture.isRunning { self.capture.stopRunning() }
   // Drain captured buffers before asking Speech for the final result.
   self.audioQueue.async {
    self.requestLock.lock(); self.request?.endAudio(); self.requestLock.unlock()
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.finish() }
   }
  }
 }
 func finish() {
  guard !finishing else { return }; finishing = true; fileTimer?.invalidate()
  if !receivedSpeech && !reportedError {
   let message = receivedAudio ? "Audio was captured from " + microphoneName + ", but no speech could be transcribed. Check that this is the microphone you are speaking into." : "No audio was received from " + microphoneName + ". Reconnect it or choose another input in macOS Sound settings."
   emit(["type":"error", "code":receivedAudio ? "no_speech" : "no_audio", "message":message])
  }
  captureQueue.async {
   if self.capture.isRunning { self.capture.stopRunning() }
   DispatchQueue.main.async { emit(["type":"done"]); exit(0) }
  }
 }

}
var fileTask: SFSpeechRecognitionTask?
let dictation = Dictation()
if argument("--control") == nil && !CommandLine.arguments.contains("--file") && !CommandLine.arguments.contains("--stream-file") { DispatchQueue.global().async {
 while let line = readLine() { if line == "stop" { DispatchQueue.main.async { dictation.stop() } } else if line == "cancel" { exit(0) } }; exit(0)
} }
if let control = argument("--control") {
 let parent = argument("--parent").flatMap(Int32.init)
 Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
  if let parent, kill(parent, 0) != 0 { exit(0) }
  if let command = try? String(contentsOfFile: control, encoding: .utf8) { if command == "cancel" { exit(0) }; if command == "stop" { dictation.stop() } }
 }
}
if eventFile != nil { _ = NSApplication.shared; NSApplication.shared.setActivationPolicy(.accessory) }
emit(["type":"boot", "pid":ProcessInfo.processInfo.processIdentifier])
SFSpeechRecognizer.requestAuthorization { status in
 guard status == .authorized else { emit(["type":"error", "message":"Allow Speech Recognition for Live Annotation in macOS Privacy & Security."]); exit(1) }
 if let file = argument("--stream-file") { DispatchQueue.main.async { dictation.startFile(URL(fileURLWithPath: file)) }; return }
 if let flag = CommandLine.arguments.firstIndex(of: "--file"), flag + 1 < CommandLine.arguments.count {
  guard recognizer?.supportsOnDeviceRecognition == true else { emit(["type":"error", "message":"On-device recognition unavailable"]); exit(1) }
  let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
  request.requiresOnDeviceRecognition = true; request.addsPunctuation = true
  fileTask = recognizer?.recognitionTask(with: request) { result, error in
   if let result, result.isFinal { emit(["type":"done", "text":result.bestTranscription.formattedString, "words":result.bestTranscription.segments.map { ["text":$0.substring,"start":$0.timestamp,"end":$0.timestamp+$0.duration] }]); exit(0) }
   if let error { emit(["type":"error", "message":error.localizedDescription]); exit(1) }
  }; return
 }
 emit(["type":"permission", "message":"Waiting for microphone access…"])
 AVCaptureDevice.requestAccess(for: .audio) { allowed in
  DispatchQueue.main.async { if allowed { dictation.start() } else { dictation.fail("Allow Microphone access for Live Annotation in macOS Privacy & Security.") } }
 }
}
if eventFile != nil { NSApplication.shared.run() } else { RunLoop.main.run() }
