import { create } from 'zustand'

/** Linked context — when you click a candidate or position, all linked panels update */
interface LinkedContextState {
  selectedMint: string | null
  setSelectedMint: (mint: string | null) => void
}

export const useLinkedContext = create<LinkedContextState>((set) => ({
  selectedMint: null,
  setSelectedMint: (mint) => set({ selectedMint: mint }),
}))
