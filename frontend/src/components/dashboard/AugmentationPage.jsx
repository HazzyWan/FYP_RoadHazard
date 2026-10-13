import React, { memo, useState } from 'react';

import HelpHint from './HelpHint';
import LoadingText from '../common/LoadingText';

const AugmentationPageContent = ({
  darkMode,
  setDashboardPage,
  augmentationSourceId,
  setAugmentationSourceId,
  allReports,
  formatLocationText,
  augmentationControls,
  setAugmentationControls,
  augmentationConfig,
  setAugmentationConfig,
  handleRunAugmentation,
  augmentationRunning,
  augmentationCanvasRefs,
  confidenceScenarios,
  confidenceError,
  confidenceSkipped,
  confidenceSkipReason,
  confidenceRequested,
  confidenceRunAt,
  confidenceConsensus,
  formatHazardLabel,
  showAugmentationCorrection,
  setShowAugmentationCorrection,
  augmentationPredictedClass,
  selectedAugmentationTargetLabel,
  setAugmentationTargetSelection,
  augmentationFeedbackCorrect,
  setAugmentationFeedbackCorrect,
  augmentationFeedbackClass,
  setAugmentationFeedbackClass,
  MANUAL_HAZARD_OPTIONS,
  augmentationFeedbackNote,
  setAugmentationFeedbackNote,
  handleAugmentationFeedbackSubmit,
  augmentationFeedbackSaving,
  normalizeBbox,
  augmentationTargetSelection,
  sameNormalizedBbox,
  normalizeHazardClass,
  getHazardBadgeClass,
  augmentationResult
}) => {
  const [enlargedImage, setEnlargedImage] = useState(null);
  return (
  <div className="container-fluid flex-grow-1 overflow-auto p-3">
    <div className="bg-white border rounded shadow-sm p-3 mb-3 d-flex justify-content-between align-items-center">
      <div>
        <h5 className="mb-1 d-flex align-items-center gap-2">
          <span>Image Augmentation Simulator</span>
          <HelpHint darkMode={darkMode} text="Generate realistic weather/lighting variants to stress-test and improve model robustness." />
        </h5>
        <div className="small text-muted">Toggle tropical effects and preview simulated conditions before retraining.</div>
      </div>
      <button className="btn btn-outline-primary" onClick={() => setDashboardPage('management')}>← Back to Management</button>
    </div>

    <div className="row g-3">
      <div className="col-xl-3">
        <div className="bg-white border rounded shadow-sm p-3">
          <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
            <span>Controls</span>
            <HelpHint text="Choose source image, effects, and batch settings before running augmentation." />
          </h6>

          <div className="mb-3">
            <label className="form-label small fw-bold">Source image</label>
            <select
              className="form-select"
              value={augmentationSourceId}
              onChange={(e) => setAugmentationSourceId(e.target.value)}
            >
              {allReports.filter((report) => Boolean((report?.mediaURL || '').trim())).map((report) => (
                <option key={report.recordId} value={report.recordId}>
                  #{report.recordId?.substring(0, 6)} • {formatLocationText(report)}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-2 form-check">
            <input className="form-check-input" type="checkbox" id="toggleSun" checked={augmentationControls.sunGlare} onChange={(e) => setAugmentationControls((current) => ({ ...current, sunGlare: e.target.checked }))} />
            <label className="form-check-label" htmlFor="toggleSun">Equatorial sun glare</label>
          </div>
          <div className="mb-2 form-check">
            <input className="form-check-input" type="checkbox" id="toggleRain" checked={augmentationControls.rain} onChange={(e) => setAugmentationControls((current) => ({ ...current, rain: e.target.checked }))} />
            <label className="form-check-label" htmlFor="toggleRain">Monsoon rain streaks</label>
          </div>
          <div className="mb-2 form-check">
            <input className="form-check-input" type="checkbox" id="toggleShadow" checked={augmentationControls.shadow} onChange={(e) => setAugmentationControls((current) => ({ ...current, shadow: e.target.checked }))} />
            <label className="form-check-label" htmlFor="toggleShadow">Canopy shadows</label>
          </div>
          <div className="mb-2 form-check">
            <input className="form-check-input" type="checkbox" id="toggleWet" checked={augmentationControls.wetSurface} onChange={(e) => setAugmentationControls((current) => ({ ...current, wetSurface: e.target.checked }))} />
            <label className="form-check-label" htmlFor="toggleWet">Wet surface reflection</label>
          </div>
          <div className="mb-2 form-check">
            <input className="form-check-input" type="checkbox" id="toggleFog" checked={augmentationControls.fog} onChange={(e) => setAugmentationControls((current) => ({ ...current, fog: e.target.checked }))} />
            <label className="form-check-label" htmlFor="toggleFog">Fog / haze</label>
          </div>
          <div className="mb-2 form-check">
            <input className="form-check-input" type="checkbox" id="toggleNight" checked={augmentationControls.lowLight} onChange={(e) => setAugmentationControls((current) => ({ ...current, lowLight: e.target.checked }))} />
            <label className="form-check-label" htmlFor="toggleNight">Low light + noise</label>
          </div>

          <div className="mt-3">
            <label className="form-label small fw-bold">Intensity ({Math.round(augmentationControls.intensity * 100)}%)</label>
            <input
              type="range"
              min="0.2"
              max="1"
              step="0.05"
              className="form-range"
              value={augmentationControls.intensity}
              onChange={(e) => setAugmentationControls((current) => ({
                ...current,
                intensity: Number(e.target.value)
              }))}
            />
          </div>

          <hr />
          <h6 className="fw-bold mb-2">Apply to Dataset</h6>
          <div className="mb-2">
            <label className="form-label small fw-bold">Reports to sample</label>
            <input
              type="number"
              min="1"
              max="200"
              className="form-control"
              value={augmentationConfig.maxItems}
              onChange={(e) => setAugmentationConfig((current) => ({
                ...current,
                maxItems: Number(e.target.value || 1)
              }))}
            />
          </div>
          <div className="mb-3 form-check">
            <input className="form-check-input" type="checkbox" id="batchRetrain" checked={augmentationConfig.triggerRetrain} onChange={(e) => setAugmentationConfig((current) => ({ ...current, triggerRetrain: e.target.checked }))} />
            <label className="form-check-label" htmlFor="batchRetrain">Trigger retrain</label>
          </div>
          <div className="mb-3 form-check">
            <input className="form-check-input" type="checkbox" id="batchConfidence" checked={Boolean(augmentationConfig.includeConfidence)} onChange={(e) => setAugmentationConfig((current) => ({ ...current, includeConfidence: e.target.checked }))} />
            <label className="form-check-label" htmlFor="batchConfidence">Run scenario confidence (slower)</label>
            <div className="small text-muted mt-1">💡 To speed up: use 1–3 reports, uncheck unused effects above, and run locally only.</div>
          </div>
          <button className="btn btn-primary w-100" onClick={handleRunAugmentation} disabled={augmentationRunning}>
            {augmentationRunning ? <LoadingText>Running augmentation</LoadingText> : 'Generate Augmented Dataset'}
          </button>
        </div>
      </div>

      <div className="col-xl-9">
        <div className="bg-white border rounded shadow-sm p-3 mb-3">
          <h6 className="fw-bold mb-2 d-flex align-items-center gap-2">
            <span>Interactive Simulation</span>
            <HelpHint text="Live preview canvas showing currently selected augmentation effects." />
          </h6>
          <div className="small text-muted mb-2">Live preview based on your toggle selections.</div>
          <canvas ref={(node) => { augmentationCanvasRefs.current.custom = node; }} className="w-100 border rounded" style={{ maxHeight: '420px', objectFit: 'contain' }} />
        </div>

        <div className="bg-white border rounded shadow-sm p-3 mb-3">
          <h6 className="fw-bold mb-2 d-flex align-items-center gap-2">
            <span>Scenario Hazard Confidence</span>
            <HelpHint text="Compares model predictions across scenarios and computes consensus confidence stability." />
          </h6>
          <div className="small text-muted mb-3">Appears after you click <strong>Generate Augmented Dataset</strong> (uses model inference per scenario).</div>

          <div className="small mb-2">
            <span className={`badge ${confidenceScenarios.length > 0 ? 'bg-success' : confidenceError ? 'bg-danger' : confidenceSkipped ? 'bg-info text-dark' : confidenceRequested ? 'bg-warning text-dark' : 'bg-secondary'}`}>
              {confidenceScenarios.length > 0 ? 'Confidence Ready' : confidenceError ? 'Confidence Error' : confidenceSkipped ? 'Confidence Skipped' : confidenceRequested ? 'Confidence Pending' : 'No Source Selected'}
            </span>
            {confidenceRunAt && <span className="text-muted ms-2">Last run: {confidenceRunAt}</span>}
          </div>

          {confidenceConsensus?.detected && (
            <div className="border rounded p-2 mb-3 bg-light">
              <div className="small text-muted">Final hazard prediction (cross-scenario consensus)</div>
              <div className="fw-bold">
                {formatHazardLabel(confidenceConsensus.hazardClass || 'unknown')} ({((confidenceConsensus.confidence || 0) * 100).toFixed(1)}%)
              </div>
              <div className="small text-muted">
                Stability: {confidenceConsensus.stable ? 'Stable' : 'Low stability'} · Support: {confidenceConsensus.supportingScenarios || 0}/{confidenceConsensus.totalDetectedScenarios || 0} scenarios
              </div>
            </div>
          )}

          <div className="mb-2">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setShowAugmentationCorrection((v) => !v)}
              disabled={!augmentationSourceId}
            >
              {showAugmentationCorrection ? 'Hide correction' : 'Correct this prediction'}
            </button>
          </div>

          {showAugmentationCorrection && (
            <div className="border rounded p-3 mb-3 bg-light">
              <div className="small text-muted mb-1">Fix wrong prediction for this source image</div>
              <div className="small mb-2">
                Current AI class: <strong>{formatHazardLabel(augmentationPredictedClass || 'unknown')}</strong>
              </div>
              <div className="alert alert-warning py-2 px-3 small mb-2">
                If the photo contains tree shadows, shade only the crack itself in the target box. A tight box helps the retraining set and also helps the same image behave better next time it is posted.
              </div>

              {selectedAugmentationTargetLabel && (
                <div className="alert alert-info py-2 px-3 small mb-2 d-flex justify-content-between align-items-center gap-2">
                  <div>
                    Selected detection target: <strong>{selectedAugmentationTargetLabel}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setAugmentationTargetSelection(null)}
                  >
                    Clear target
                  </button>
                </div>
              )}

              <div className="d-flex align-items-center gap-4 mb-2">
                <div className="form-check mb-0">
                  <input
                    className="form-check-input"
                    type="radio"
                    id="augFeedbackCorrect"
                    checked={augmentationFeedbackCorrect === true}
                    onChange={() => setAugmentationFeedbackCorrect(true)}
                  />
                  <label className="form-check-label" htmlFor="augFeedbackCorrect">Prediction is correct</label>
                </div>
                <div className="form-check mb-0">
                  <input
                    className="form-check-input"
                    type="radio"
                    id="augFeedbackWrong"
                    checked={augmentationFeedbackCorrect === false}
                    onChange={() => setAugmentationFeedbackCorrect(false)}
                  />
                  <label className="form-check-label" htmlFor="augFeedbackWrong">Prediction is wrong</label>
                </div>
              </div>

              {augmentationFeedbackCorrect === false && (
                <div className="mb-2">
                  <label className="form-label small fw-bold mb-1">Correct hazard class</label>
                  <select
                    className="form-select form-select-sm"
                    value={augmentationFeedbackClass}
                    onChange={(e) => setAugmentationFeedbackClass(e.target.value)}
                  >
                    {MANUAL_HAZARD_OPTIONS.map((hazardClass) => (
                      <option key={hazardClass} value={hazardClass}>{formatHazardLabel(hazardClass)}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mb-2">
                <label className="form-label small fw-bold mb-1">Note (optional)</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={augmentationFeedbackNote}
                  onChange={(e) => setAugmentationFeedbackNote(e.target.value)}
                  placeholder="Why this prediction is right/wrong"
                />
              </div>

              <button
                className="btn btn-sm btn-outline-primary"
                onClick={handleAugmentationFeedbackSubmit}
                disabled={augmentationFeedbackSaving || !augmentationSourceId || (augmentationFeedbackCorrect !== true && augmentationFeedbackCorrect !== false)}
              >
                {augmentationFeedbackSaving ? <LoadingText>Saving correction</LoadingText> : 'Save Correction for Source Image'}
              </button>
            </div>
          )}

          {confidenceScenarios.length > 0 ? (
            <>
              <div className="table-responsive mb-3">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Top Hazard</th>
                      <th>Confidence</th>
                      <th>Detections</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confidenceScenarios.map((scenario) => (
                      <tr key={scenario.scenario}>
                        <td>{formatHazardLabel(String(scenario.scenario || '').replace(/_/g, ' '))}</td>
                        <td>{scenario.detected ? formatHazardLabel(scenario.topClass || 'unknown') : 'No hazard detected'}</td>
                        <td>{scenario.detected ? `${((scenario.topConfidence || 0) * 100).toFixed(1)}%` : '--'}</td>
                        <td>{scenario.numDetections ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="small text-muted mb-2">Generated scenario previews with detected boxes. For multi-hazard images, select the exact wrong box before saving correction.</div>
              <div className="row g-3">
                {confidenceScenarios.map((scenario) => (
                  <div key={`preview_${scenario.scenario}`} className="col-md-6 col-xl-4">
                    <div className="border rounded p-2 h-100 bg-light-subtle">
                      <div className="fw-bold small mb-2 d-flex justify-content-between align-items-center gap-2">
                        <span>{formatHazardLabel(String(scenario.scenario || '').replace(/_/g, ' '))}</span>
                        <span className={`badge ${scenario.detected ? getHazardBadgeClass(scenario.topClass || 'unknown') : 'bg-secondary'}`}>
                          {scenario.detected ? formatHazardLabel(scenario.topClass || 'unknown') : 'No Detection'}
                        </span>
                      </div>

                      {(scenario.imageData || scenario.previewImage) ? (
                        <div
                          className="position-relative border rounded overflow-hidden mb-2 bg-white"
                          style={{ height: '220px', cursor: 'pointer' }}
                          onClick={() => setEnlargedImage({ src: scenario.previewImage || scenario.imageData, title: `${formatHazardLabel(String(scenario.scenario || '').replace(/_/g, ' '))} - Preview` })}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setEnlargedImage({ src: scenario.previewImage || scenario.imageData, title: `${formatHazardLabel(String(scenario.scenario || '').replace(/_/g, ' '))} - Preview` }); }}
                        >
                          <img
                            src={scenario.previewImage || scenario.imageData}
                            alt={`${scenario.scenario} preview`}
                            className="w-100 h-100"
                            style={{ objectFit: 'contain', display: 'block', backgroundColor: '#f8f9fa' }}
                          />
                        </div>
                      ) : (
                        <div className="border rounded d-flex align-items-center justify-content-center text-muted small mb-2" style={{ height: '180px' }}>
                          Preview unavailable
                        </div>
                      )}

                      <div className="small text-muted mb-2">
                        {scenario.detected ? `Top confidence: ${((scenario.topConfidence || 0) * 100).toFixed(1)}%` : 'No hazard detected in this scenario'}
                      </div>

                      <div className="d-flex flex-column gap-2">
                        {(scenario.detections || []).length > 0 ? (
                          scenario.detections.map((detection, idx) => {
                            const normalizedScenarioBox = normalizeBbox(detection?.bbox);
                            const isSelected = augmentationTargetSelection
                              && augmentationTargetSelection.scenarioKey === scenario.scenario
                              && (augmentationTargetSelection.detectionIndex === (detection?.index ?? idx)
                                || sameNormalizedBbox(augmentationTargetSelection.bbox, normalizedScenarioBox));
                            return (
                              <button
                                key={`${scenario.scenario}_${detection?.index ?? idx}`}
                                type="button"
                                className={`btn btn-sm text-start ${isSelected ? 'btn-primary' : 'btn-outline-secondary'}`}
                                onClick={() => {
                                  setShowAugmentationCorrection(true);
                                  setAugmentationTargetSelection({
                                    scenarioKey: scenario.scenario,
                                    scenarioTitle: scenario.scenario,
                                    detectionIndex: detection?.index ?? idx,
                                    predictedClass: normalizeHazardClass(detection?.class || 'crack'),
                                    confidence: Number(detection?.confidence || 0),
                                    bbox: normalizedScenarioBox
                                  });
                                }}
                              >
                                <div className="fw-bold">{formatHazardLabel(detection?.class || 'unknown')}</div>
                                <div className="small opacity-75">Confidence: {((detection?.confidence || 0) * 100).toFixed(1)}%</div>
                              </button>
                            );
                          })
                        ) : (
                          <div className="small text-muted">No detections in this scenario.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : confidenceError ? (
            <div className="border rounded p-3 bg-danger-subtle text-danger small">
              Confidence analysis warning: {confidenceError}
            </div>
          ) : confidenceSkipped ? (
            <div className="border rounded p-3 bg-info-subtle text-dark small">
              Confidence analysis was skipped: {confidenceSkipReason || 'disabled by configuration.'}
            </div>
          ) : confidenceRequested ? (
            <div className="border rounded p-3 bg-warning-subtle text-dark small">
              Confidence was requested, but no scenario rows were returned. Re-run Generate once and check backend logs if this persists.
            </div>
          ) : (
            <div className="border rounded p-3 bg-light text-muted small">
              Select a source image and run <strong>Generate Augmented Dataset</strong> to view confidence.
            </div>
          )}
        </div>

        {(augmentationResult?.error || augmentationResult?.status === 'success') && (
          <div className="bg-white border rounded shadow-sm p-3">
            {augmentationResult?.error && (
              <div className="alert alert-danger mb-0">{augmentationResult.error}</div>
            )}

            {augmentationResult?.status === 'success' && (
              <div className="alert alert-success mb-0">
                <div className="fw-bold mb-1">Dataset augmentation complete</div>
                <div className="small">Reports used: {augmentationResult?.augmentation?.selectedReports ?? 0}</div>
                <div className="small">Samples generated: {augmentationResult?.augmentation?.generatedSamples ?? 0}</div>
                <div className="small">Skipped reports: {augmentationResult?.augmentation?.skippedReports ?? 0}</div>
                <div className="small">Failed reports: {augmentationResult?.augmentation?.failedReports ?? 0}</div>
                {augmentationResult?.augmentation?.runtimeExceeded && (
                  <div className="small text-warning-emphasis">Processing stopped early to avoid request timeout. Re-run with fewer reports if needed.</div>
                )}
                <div className="small">Retrain state: {augmentationResult?.retrainState || 'not_requested'}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {enlargedImage && (
      <div
        className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          zIndex: 9999,
          cursor: 'pointer'
        }}
        onClick={() => setEnlargedImage(null)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Escape') setEnlargedImage(null); }}
      >
        <div
          className="position-relative d-flex flex-column align-items-center justify-content-center"
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            cursor: 'default'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 text-white small">{enlargedImage.title}</div>
          <img
            src={enlargedImage.src}
            alt="Enlarged preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
            }}
          />
          <div className="mt-2 text-white-50 small text-center">Click anywhere to close</div>
        </div>
      </div>
    )}
  </div>
  );
};

const AugmentationPage = memo(AugmentationPageContent);
export default AugmentationPage;
