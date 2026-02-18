'use client';

import { useEffect, useState } from 'react';
import { fetchPhotos, deletePhotoRemote, supabaseConfigured, type SavedPhoto } from '@/lib/storage';
import Link from 'next/link';

export default function SavedPage() {
  const [photos, setPhotos] = useState<SavedPhoto[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchPhotos();
        setPhotos(data);
      } catch (err) {
        console.error(err);
        setPhotos([]);
      }
    })();
  }, []);

  const handleDelete = (id: string) => {
    deletePhotoRemote(id).then(() => {
      setPhotos((prev) => prev.filter((p) => p.id !== id));
    });
  };

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <header className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm border-b border-white/10 px-4 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Saved</h1>
        <p className="text-sm text-white/60 mt-0.5">
          {photos.length === 0 ? 'No photos yet' : `${photos.length} photo${photos.length !== 1 ? 's' : ''}`}
          {supabaseConfigured ? ' · Supabase' : ' · Supabase env missing'}
        </p>
      </header>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 pt-32 text-center">
          <span className="text-6xl mb-4">📷</span>
          <h2 className="text-xl font-semibold mb-2">No saved photos yet</h2>
          <p className="text-white/50 text-sm max-w-xs">
            Match a pose in the camera to save your first photo here.
          </p>
        </div>
      ) : (
        <div className="px-4 py-4 grid grid-cols-2 gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="rounded-2xl overflow-hidden bg-white/5 border border-white/10"
            >
              <img
                src={photo.photoDataUrl}
                alt={photo.poseName}
                className="w-full aspect-[3/4] object-cover"
              />
              <div className="p-3">
                <h3 className="font-semibold text-sm">{photo.poseName}</h3>
                <div className="flex items-center justify-between mt-1 text-xs text-white/50">
                  <span className="text-green-400">{photo.score}% match</span>
                  <span>{new Date(photo.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-white/60">
                  <button
                    onClick={() => handleDelete(photo.id)}
                    className="text-white/40 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        sessionStorage.setItem(
                          'selectedPose',
                          JSON.stringify({
                            name: photo.poseName,
                            imageUrl: photo.photoDataUrl,
                          })
                        );
                        window.location.href = '/camera';
                      }
                    }}
                    className="text-white font-semibold hover:underline"
                  >
                    Shoot
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
